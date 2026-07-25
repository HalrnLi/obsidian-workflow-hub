# 代码评审报告：obsidian-workflow-hub（工作流中心）

评审范围：全量静态评审 `src/` 与 `tests/`，并运行 `tsc --noEmit`（**通过，可编译**）。
结论：**项目能编译，但存在 1 个高危数据丢失 bug、多处安全/数据完整性隐患，以及若干工程问题。** 按严重程度排序如下。

---

## 🔴 严重（数据丢失 / 安全）

### 1. `updateProject` 每次保存都会丢失 `projectInfo`（项目信息条目）— 静默数据丢失
- 位置：`src/services/DataService.ts` `updateProject()` 的 `createFrontmatter(...)` 调用（约 877–902 行），**未写入 `projectInfo` 字段**。
- 触发路径：`src/view/ProjectInfoSection.ts:54` 保存项目信息条目时调用 `updateProject(id, { projectInfo: items }, version)`。数据进入内存对象 `updatedProject`，但序列化时未包含该字段 → 文件里没有 `projectInfo` → 下次加载解析为 `[]`。
- 影响：**用户添加/编辑的「项目信息条目」在下次重载后全部消失**。CSV / Excel 导入走 `updateProject` 同样受影响。
- 修复：在 `updateProject` 的 frontmatter 对象中加入 `projectInfo: updatedProject.projectInfo`，或统一改为调用 `createFrontmatter` 传入完整 `updatedProject`（并对数组对象正确序列化）。

### 2. 视图层未校验 `href` / `window.open` 协议 → 存储型 XSS（渲染进程脚本执行）
- 直接把用户可控字段设为链接 `href`，未做协议白名单：
  - `src/view/TableView.ts:310,323`（`project.projectLink` / `project.componentLink`）
  - `src/view/DualPaneView.ts:359,372`
  - `src/view/AppVersionManagerView.ts:780,792`
- 另外两处用 `window.open(todo.link)` 直接打开未校验链接：
  - `src/view/ProjectTodoSection.ts:85`
  - `src/view/TodoTabView.ts:192`
- 风险：若 `projectLink`/`componentLink`/`todo.link` 为 `javascript:...`，在 Obsidian 桌面端（Electron/Chromium）点击链接可在渲染进程执行任意 JS。**属于高危存储型 XSS**。
- 对比：同仓 `src/utils/linkUtils.ts:3` 的 `openExternalLink` 已做了 `http/https` 协议白名单——其它几处还停留在 `href:'#'`+点击校验的安全写法，说明这两条路径是疏漏。
- 修复：统一通过 `openExternalLink()`（或同样的协议校验）打开上述链接，不要直接把原始字符串塞进 `href`。

### 3. 备份/恢复不包含 Todo 与 Category → 恢复时静默丢失全部待办与分类
- 位置：`src/services/BackupService.ts` `performBackup()`（73–100 行）只序列化 `apps / versions / projects`。
- 影响：执行「立即备份」后若再「从备份恢复」，**所有待办（Todo）与分类（Category）都会丢失**（恢复逻辑 `restoreFromContent` 也只处理这三类）。
- 修复：备份时一并导出 `todoService.getAllTodos()` 与 `categoryService.getAll()`；恢复时一并还原。

---

## 🟠 中危（正确性与数据完整性）

### 4. 自研 YAML frontmatter 解析/序列化过于脆弱（根因：未用 Obsidian 自带 `parseYaml`/`stringifyYaml`）
- 位置：`src/utils/frontmatter.ts`
- 问题：
  - 序列化不转义/不加引号：字段值以 `key: value` 原样写出。若值形如 `true`/`false`/`null`/`~`、或以 `[`、`{`、`|`、`>`、`#`、`*`、`&`、`!`、`%`、`?`、`@`、`-`(行首)、`:`(行首) 开头，重解析时语义会改变。例如 `features: [WIP]` 会被解析成数组 `['WIP']`，污染字段类型。
  - `parseFrontmatter` 仅匹配 `^---\n...\n---`：**CRLF（Windows）行结尾的文件会整体解析失败**。
  - 仅做 `true/false/null` 的布尔/空值转换，其它类型不保证。
- 修复：**改用 Obsidian 提供的 `parseYaml` / `stringifyYaml`**（已随 `obsidian` 包导出），彻底消除转义与类型问题。

### 5. 时间戳格式不统一（ISO vs 毫秒字符串）→ 更新后显示错乱
- 位置：`createProject`/`TodoService.create` 用 `nowISO()`（ISO UTC），而 `createApp`/`createVersion`/`createPlan`/`updateProject`/`updateApp`/`updateVersion`/`updatePlan` 大量使用 `Date.now().toString()`（13 位毫秒字符串）。
- 影响：显示辅助函数 `formatISOToLocal`/`formatISOToDate` 假设 ISO；更新后的 `updatedAt` 变成毫秒串，`new Date('1753…')` 解析为 Invalid Date → 显示为空或裸数字。同一 App 内 App/Version 用毫秒、Project/Todo 用 ISO，互相不一致。
- 修复：全局统一使用 `nowISO()`；存量数据可用 `dateUtils.toISO()` 在读取时归一化。

### 6. `parseFrontmatter` 无 frontmatter 时返回 `{}`（truthy）而非 `null`
- 位置：`frontmatter.ts:3-4`
- 影响：数据目录里任何没有 `---` 块的 `.md` 文件都会被当成实体解析，且 `id` 退化为 `file.basename`，产生「幽灵实体」。
- 修复：无 frontmatter 时返回 `null`，调用方已有 `if (!frontmatter) return null` 分支。

### 7. `deleteApp` / `deleteVersion` 非原子，无回滚
- 位置：`DataService.ts` 两处删除（约 402 / 625 行），注释已承认「第二阶段执行若失败不会回滚」。
- 风险：中途异常会导致「项目 versionId 已被清空但版本文件未删」或反之的悬挂引用/不一致。
- 修复：先做删除收集与校验，再在 try 内全部执行，catch 中按已删除清单回滚；或迁移到事务性写入。

### 8. 依赖 `xlsx@0.18.5` 存在已知 CVE
- `CVE-2023-30533`（原型污染）、`CVE-2024-22363`（ReDoS）。`ImportExportService.importFromExcel` 直接 `XLSX.read(用户提供的 buffer)`。
- 修复：升级到 `xlsx >= 0.20.2`（或迁移到维护更积极的 `xlsx-js-style` / `exceljs`）。

### 9. 绝对路径模式绕过 Obsidian 沙箱 + 同步阻塞 I/O
- 位置：`dataPath` 支持绝对路径（`isAbsolutePath()`）。此时用原生 `fs` 的 **同步** API（`readdirSync`/`writeFileSync`/`unlinkSync`/`renameSync`/`mkdirSync`）在 async 方法内读写。
- 风险：① 可越过 vault 在进程权限内的任意位置读写删除，配置不当即误伤；② 同步 I/O 在数据量大时冻结 UI 线程。
- 修复：限制为 vault 内路径或显式警告；如保留绝对路径，请改用 `fs/promises` 异步 API。

---

## 🟡 低危 / 工程

### 10. `npm run version` 脚本引用不存在的文件
- `package.json` 中 `"version": "node version-bump.mjs && ..."`，但仓库**没有 `version-bump.mjs`**，脚本会失败。
- 同时缺少 `versions.json`（Obsidian 插件发布/升级必需，用于映射 app 版本）。

### 11. 迁移后旧数据不清理
- `MigrationService` 只备份 + 写入新目录，不删除旧的 `app-version-manager` 与 `todolist/tasks.json`。若用户把 `dataPath` 设为与 `oldDataPath`（`app-version-manager`）相同，存在重复迁移风险。

### 12. CSV 导入不处理带引号的换行
- `importFromCSV` 先用 `split(/\r?\n/)` 切行，再 `parseCSVLine`；引号内包含换行/换行的单元格会被错误切分。

### 13. 性能
- 绝对路径模式下每次 update 都遍历目录逐个解析文件以按 id 定位（O(n)）；`getMarkdownFiles` 用同步 `readdirSync`；缓存 TTL 30s，并发编辑可能短暂读到旧数据。

### 14. `createFrontmatter` 传入非数组对象值会写成 `[object Object]`
- 例如 `upsertAppRecord(record as unknown as Record<string, unknown>)`，若 record 含嵌套非数组对象，序列化后变成字符串 `[object Object]`，回读即损坏。

---

## 优先修复建议
1. **立刻修 #1（projectInfo 丢失）与 #2（href XSS）**——前者直接丢数据，后者是高危安全漏洞。
2. **#3 备份补全 Todo/Category**——否则备份功能形同虚设。
3. **#4 用 Obsidian 的 `parseYaml/stringifyYaml` 替换自研 frontmatter**——一次性消除第 4、5（部分）、6 类问题。
4. **#8 升级 xlsx** 到安全版本。
5. 清理工程项 #10、#11。

> 注：以上均基于静态代码分析；运行时（Obsidian 桌面端）行为建议配合实际数据做一次端到端验证（尤其 #1、#2、#3）。
