# 代码评审结论（Code Review）

> 评审对象：`obsidian-workflow-hub`（Obsidian 插件，TypeScript，约 12.5k 行）
> 评审方式：逐文件静态阅读 `src/` 下全部源码（types / utils / services / view 四层）
> 目标：只找潜藏 bug，不修复。以下均标注文件与行号，便于定位。

---

## 严重（High）

### 1. 时区导致的「差一天」计算错误（影响项目/待办的延期、预警、下一阶段判定）
**根因**：所有把 `"YYYY-MM-DD"` 这样的纯日期字符串传给 `new Date(...)` 再 `.setHours(0,0,0,0)` 的代码，都会因为 **ES 规范把「纯日期 ISO 字符串」解析为 UTC 零点** 而在非 UTC 时区（如中国 UTC+8）被错误地回拨一天。

**触发点**：
- `src/types.ts:439-467` `getNextStageInfo()` —— `new Date(timeStr)`（timeStr 是 `"2026-07-30"` 这类日期）→ `setHours(0,0,0,0)`。
- `src/types.ts:422-436` `getCurrentBRound()` 调用了上面的函数。
- `src/utils/projectSorting.ts` 的 4 个函数：`calculateOverdueStats(15-50)`、`sortProjectsByPriority(52-101)`、`isProjectHighlighted(103-115)`、`checkOverdue(117-137)` —— 都 `new Date(nextStageInfo.time)` 后 `setHours(0,0,0,0)`。
- `src/utils/todoUtils.ts` `isUrgentTask(45-53)`、`isOverdueTask(56-63)` —— 同样用 `new Date(todo.dueDate)`。
- `src/view/TodoTabView.ts:585` 右键「到期提醒」里 `new Date(todo.dueDate)`。

**具体后果（以中国 UTC+8 为例）**：`new Date("2026-07-30")` 被当作 UTC 零点 = 本地 `2026-07-29 16:00`，再 `setHours(0,0,0,0)` 变成 `2026-07-29 00:00`。于是：
- 把「今天」的提测计划当成「昨天（已过期）」——`getNextStageInfo` 返回 `stage:'无'`，表格「下一阶段时间」列对今天计划显示空白；
- 延期/预警判定整体提前一天：今天到期的项目会被标成「已延期/预警」，明天到期的被当成「今天预警」；
- 项目卡片高亮、逾期行、`currentRound` 当前 B 轮判断全部偏移一天。

**建议方向**（仅评审，不改动）：把日期字符串直接按本地零点构造，例如 `const [y,m,d]=s.split('-').map(Number); const dt=new Date(y, m-1, d);`，或在比较时使用本地年月日分量，绝不走 `new Date(纯日期字符串)`。

> 注：`TodoService.getOverdueTodos` / `getProjectTodoStats` 用的是字符串比较 `todo.dueDate < todayStr()`（无 `new Date`），反而是正确的——两套逻辑不一致，正好佐证了上面的 `new Date` 做法有问题。

---

## 中（Medium）

### 2. `parseProjectFile` 在「绝对路径数据目录」模式下会读不到项目文件
**位置**：`src/services/DataService.ts:601-615`
```ts
const filePath = file.path;
const content = await this.app.vault.adapter.read(filePath);
```
与同文件的 `parseAppFile(139-152)`、`parseVersionFile(404-417)` 不同，这里**没有**判断 `'readContent' in file`，永远走 `vault.adapter.read`。在 `FilePathResolver.isAbsolutePath()` 为 true 时，`file.path` 是真实文件系统绝对路径（来自 `CustomFile.readContent`）。
- Windows 下 vault adapter 无法解析带盘符的绝对路径 → `read` 抛错 → `catch` 返回 `null` → **所有项目在绝对路径模式下全部消失**。
- 即使在其它平台，也绕过了 fs 版的 `CustomFile`，与另两个解析器行为不一致。

### 3. 迁移服务无法写入「绝对路径数据目录」
**位置**：`src/services/MigrationService.ts:513-522`（`writeNewFile` / `ensureVaultFolder`），以及 `:509-511`（`newFilePath` 直接用 `dataPath` 拼接，未走 `FilePathResolver.joinPath`）。
读取侧（`listOldMarkdownFiles`、`readTodolistTasks`）已经支持绝对路径，但写入侧始终用 `this.plugin.app.vault`（vault 相对路径）。一旦用户在设置里把 `dataPath` 设为绝对路径并触发迁移：读取成功、写入失败 → 迁移实际不可用。相对路径模式下 `newFilePath` 也未用 `joinPath`，存在拼接隐患。

### 4. 迁移时静默丢弃项目与版本的关联（数据丢失）
**位置**：`src/services/MigrationService.ts:283-309`
迁移每个项目时写死 `appVersionLinks: [] as Record<string,string>[]`，没有任何把旧 AVM 的 project↔version 关联映射过来的逻辑。若旧数据中存在关联，迁移后**全部丢失**，且过程无警告。

### 5. 备份恢复的回滚不完整（todos / categories 不会被回滚）
**位置**：`src/services/BackupService.ts:128-219`（`rollback` / `doRollback`）、`:271-285`（`restoreFromContent`）。
回滚只恢复 apps / versions / projects。若 `restoreFromContent` 在写入 todos/categories 中途失败（或整次恢复后想撤销），todos 与 categories 永远不被回滚，导致数据处于混合/不一致状态。

### 6. 智能继承会覆盖 `createdAt`，破坏原始创建日期
**位置**：`src/services/TodoInheritanceService.ts:74-78`
```ts
const pending = todos.filter((t) => t.status !== 'done' && t.createdAt.slice(0,10) < today);
for (const todo of pending) {
  await this.plugin.todoService.update(todo.id, { createdAt: today + 'T00:00:00.000Z' });
}
```
- 把所有历史未完成待办的 `createdAt` 改写成「今天」，原始创建日期丢失；而 `queryTodos` 的 `createdDateFrom/To` 和 `sortTodos` 的创建时间排序都依赖 `createdAt`，会因此失真。
- `updatedAt` 未被同步更新，字段前后不一致。
- 边界：本地「今天」创建的待办，其 ISO `createdAt` 的 UTC 部分是「昨天」，会被 `slice(0,10) < today` 命中而再次被搬到今天，属于无谓改写。

---

## 低（Low）

### 7. CSV 导入未处理 UTF-8 BOM
**位置**：`src/services/ImportExportService.ts:125-127`（`importFromCSV` 首行 `lines[0]`）。
若 CSV 带 BOM，首列表头变成 `\ufeff项目名称`，与 `rowData['项目名称']` 永远不匹配，导致**每一行都报「缺少项目名称」**。应先 `lines[0] = lines[0].replace(/^﻿/, '')`。

### 8. CSV/Excel 导入时同一 APP 的多个版本被去重丢弃
**位置**：`src/services/ImportExportService.ts:239`
```ts
if (!links.some((l) => l.appId === app.id)) { links.push(...) }
```
当一行里出现 `APP-A/v1; APP-A/v2`（同一 app 两个版本）时，第二个会被丢弃。`ProjectLink` 模型本身允许多个，导入逻辑与模型不一致，属于潜在数据丢失。

### 9. 迁移自检过弱，单条失败不会被发现
**位置**：`src/services/MigrationService.ts:555-570`（`verify`）。
`verify` 只在存在 `level==='error'` 日志时才失败；而逐条解析失败是用 `'warn'` 记录的。所以「100 个项目里 30 个解析失败」也会通过自检并标记 `migrationCompleted=true`，掩盖数据丢失。

### 10. `queryTodos` 全局负责人筛选与显式筛选互相打架
**位置**：`src/services/TodoService.ts:305-312`（`getAllTodos` 已按 `currentResponsiblePerson` 过滤）、`:434-436`（又叠加 `filter.responsiblePerson`）。
当全局设置了负责人、调用方又传入不同的 `responsiblePerson` 时，两个筛选叠加结果为空，而非返回所请求的负责人待办。应让显式参数覆盖/优先生效。

### 11. 待办 Tab 的临时待办在每次刷新时被清空
**位置**：`src/view/AppVersionManagerView.ts:154-155`（`refresh` → `renderMainView` 重建 `TodoTabView`）。
`refresh()`（手动刷新、自动刷新、提醒回调触发）都会重新 `new TodoTabView`，导致内存中的「临时待办」以及正在输入的临时内容被整体丢弃。临时待办本就是内存态，但自动刷新（默认 2 分钟）在用户打字时清掉内容是真实的数据/体验问题。

### 12. `notifyViewsToRefresh` 是空触发
**位置**：`src/services/ReminderService.ts`（多处调用 `this.plugin.notifyViewsToRefresh()`），`src/main.ts:98-100`。
`notifyViewsToRefresh` 只 `workspace.trigger('app-version-manager:refresh')`，但没有任何视图订阅该事件，所以提醒触发后界面不会刷新（仅 toast 弹出）。属于死代码/无效刷新。

### 13. 其它小点（非阻断）
- `src/utils/DataCache.ts`：TTL 过期只在 `get`/`set` 时清理（`cleanupExpired` 仅在 `set` 达容量上限时触发），长期不访问的过期条目会一直驻留内存——不影响正确性，仅内存占用。
- `src/utils/idUtils.ts:21-41` `compareVersions` 把 `1.2` 与 `1.2.0` 视为相等（按缺省补 0 比较），若同一 app 同时出现这两种写法则排序并列，属于边界情况。
- `src/utils/linkUtils.ts:3-15`：对 `javascript:...` 这类输入会前缀成 `https://javascript:...`，`new URL` 判定 protocol 为 `https:` 而放行；浏览器会把它当 host 处理、不会执行脚本，实际不可利用，但输入未做 scheme 白名单显式拦截，建议留意为后续隐患。

---

## 评审总结
- **最该优先修的是 #1（时区差一天）**：它来自一个共同的 `new Date(纯日期字符串)` 误用，影响项目延期/预警/下一阶段/当前 B 轮以及待办紧急度，是高频路径上的功能性 bug，且在中国时区下 100% 触发。
- **#2 / #3 / #4** 与「绝对路径数据目录」和「数据迁移」两条能力相关，平时相对路径默认配置下不暴露，但一旦用户启用绝对路径或执行迁移就会出问题，建议一并修。
- **#5 / #6 / #8** 属于「静默数据丢失/不一致」类，风险高但触发条件较特定，需重点回归测试。
- 其余为健壮性/体验/死代码类，可排期清理。

> 本文件仅记录评审发现，未做任何代码修改。

---

## 修复复核（2026-07-31）

用户已就上述全部 11 项问题提交修改。复核结论：**修复正确且完整**，已通过 `tsc` 类型检查与 `esbuild` 构建，151 个单测全部通过。

### 逐项确认
| # | 问题 | 修复方式 | 结论 |
|---|------|----------|------|
| 1 | 时区差一天 | 新增 `parseLocalDate`/`todayStart`，替换所有 `new Date(纯日期)`；`getNextStageInfo`/`getCurrentBRound`(经前者)、`projectSorting`、`todoUtils`、`TodoTabView` 均改用 | ✅ 正确 |
| 2 | `parseProjectFile` 绝对路径读不到 | 改用 `file.readContent()`（有则），否则 `vault.adapter.read` | ✅ 正确 |
| 3 | 迁移写入侧不支持绝对路径 / 丢失关联 | `ensureFolder`/`writeNewFile`/`newFilePath`/`writeNewTodo` 按绝对/相对分流；`appVersionLinks` 改为保留旧值 | ✅ 正确 |
| 4 | 备份回滚不回滚 todos/categories | `BackupService` 两处 rollback 均补全 todos/categories 的还原与删除 | ✅ 正确 |
| 5 | 继承覆盖 `createdAt` | 改为仅更新 `updatedAt`（`nowISO`） | ✅ 正确 |
| 6 | CSV BOM 致首列不匹配 | 读取时剥离 `\uFEFF` | ✅ 正确 |
| 7 | 同 APP 多版本被去重丢弃 | 去重键改为 `appId+versionId` | ✅ 正确 |
| 8 | 迁移 `verify` 放过 warn | 存在 warn 时记录提示日志 | ✅ 正确 |
| 9 | `queryTodos` 全局/显式负责人冲突 | 显式传入 `responsiblePerson` 时走 `getAllTodosBypassFilter` | ✅ 正确 |
| 10 | 待办 Tab 每次 refresh 清空临时待办 | `todoTabView` 改为只创建一次，后续仅 `render()` | ✅ 正确 |
| 11 | `notifyViewsToRefresh` 触发无人订阅事件 | 新增 `registerRefreshHandler`，`AppVersionManagerView` 在 `onOpen` 订阅、`onClose` 取消 | ✅ 正确（事件名一致） |

额外加固：`linkUtils` 增加 scheme 白名单（仅允许 http/https，双重校验 `url.protocol`）；`DataCache` 增加定期清理定时器（`unref` 防阻塞进程退出）+ `destroy()`。

### 复核中发现的次要注意点（非回归，按需处理）
- **Windows + 绝对路径数据目录**：`writeNewFile`/`newFilePath` 用 `path.substring(0, path.lastIndexOf('/'))` 取目录，而绝对路径经 `join()` 在 Windows 上为 `\` 分隔符，会导致 `dir` 取错（甚至空串）并 `createFolder("")` 抛错。建议绝对分支改用 `dirname(path)`。仅在 Windows 且启用绝对路径存储时触发，影响较窄。
- **TodoTabView 日期范围筛选语义变化**：由「按创建日期」改为「按更新日期」，与 #5 的继承改更新 `updatedAt` 一致，但属行为变更，建议确认是否符合预期 UX。
- **linkUtils 拒绝非 http(s) scheme**：`mailto:`/`obsidian://`/`file:` 等链接现会被拒绝（此前会被错误前缀成 `https://...`）。若将来有打开此类链接的需求需另寻通道。
- **DST 边界**：`parseLocalDate`/`todayStart` 均为本地零点，跨夏令时切换当天 `Math.floor(差值/天)` 有 ±1 天理论误差，概率极低，原代码同存在此特性。
