# 项目代码评审报告 — obsidian-workflow-hub

- 评审日期：2026-08-02
- 评审范围：`src/` 全部源码（服务层、视图层、工具层、样式）、`tests/`、构建配置
- 验证手段：全量代码走读 + `tsc -noEmit`（0 错误）+ `vitest run`（152/152 通过）+ 构建产物检查

---

## 一、总体结论

项目整体架构清晰（服务层 / 视图层分离、内存索引 + TTL 缓存、frontmatter 持久化），类型检查和现有 152 个测试全部通过。但当前工作区存在 **3 个 P0 级问题**，其中 2 个会让插件在当前代码下直接无法正常工作：

1. **`DataConfigService.load()` 在 `dataService` 初始化之前调用 → 插件 onload 直接抛 TypeError，无法启用**（当前部署的 main.js 同样存在该问题）。
2. **设置面板改动不再持久化**：所有插件级设置（dataPath、备份、预警天数、刷新间隔等）的 onChange 都从 `saveSettings()` 误改为 `dataConfigService.save()`，写入的是另一个配置文件，`PluginSettings` 永远不落盘，重启后全部恢复默认。
3. **`versions:all` 缓存无任何失效路径** + **备份恢复后 DataService 缓存不失效**，同一会话内会读到旧数据，极端情况下（恢复后立刻删除）可能基于旧数据操作。

另外发现若干高/中优先级问题（缓存与磁盘不一致、时区偏移、版本排序错误、提醒 setTimeout 溢出、负责人切换全量重读磁盘等），详见下文。这些问题大多集中在最近引入的 `DataConfigService` 重构和缓存机制上，建议在下一个版本前集中修复。

---

## 二、P0 — 严重问题（插件无法工作 / 数据风险）

### P0-1 初始化顺序错误：`DataConfigService.load()` 在 `DataService` 创建前调用，插件 onload 抛错

`src/main.ts:32-34`

```ts
this.dataConfigService = new DataConfigService(this);
await this.dataConfigService.load();
this.dataService = new DataService(this.app, this);   // ← dataService 此时还是 undefined
```

`DataConfigService.load()` → `getConfigPath()`（`DataConfigService.ts:35-41`）访问 `this.plugin.dataService.pathResolver`，而 `plugin.dataService` 此刻为 `undefined`，抛出 `TypeError`。该异常发生在 `load()` 的 try/catch **之外**（`DataConfigService.ts:43-54`），会向上传播导致 `onload()` reject，插件无法启用。

- 已构建的 `main.js`（43340-43341 行）也是相同顺序，**当前部署版本同样受影响**。
- 附带影响：即使修复顺序，也建议确认 `loadFromVault/loadFromAbsolute` 对失败路径的 `loaded = true` 标记——目前一旦加载失败，本次会话不会再重试。

**修复**：把 `dataService` 的创建提前到 `dataConfigService.load()` 之前（`DataService` 构造不依赖 config，仅依赖 settings.dataPath）。

### P0-2 设置面板的插件级设置不再持久化（saveSettings 被误替换为 dataConfigService.save）

`src/main.ts` 设置面板中以下 onChange 全部改为 `await this.plugin.dataConfigService.save()`（仅序列化 `DataConfig` 到 `{dataPath}/.workflow-hub-config.json`），但这些修改的是 `this.plugin.settings.*`（`PluginSettings`，持久化走 `saveData()`）：

| 设置项 | 位置 | 实际写入对象 |
|---|---|---|
| dataPath | main.ts:195 | settings（未落盘）✗ |
| autoBackup | main.ts:234 | settings（未落盘）✗ |
| backupPath | main.ts:252 | settings（未落盘）✗ |
| backupDay / backupHour | main.ts:280 / 295 | settings（未落盘）✗ |
| overdueWarningDays | main.ts:312 | settings（未落盘）✗ |
| autoRefreshInterval | main.ts:391 | settings（未落盘）✗ |
| oldDataPath | main.ts:472 | settings（未落盘）✗ |
| tableColumns / preReleaseRound / progressStages / responsiblePersons / defaultTodos | main.ts:353,374,411,425,529... | config（正确）✓ |

**结果：以上 7 项设置重启后全部恢复默认值**（自动备份、备份日/时间、预警天数、自动刷新、数据路径等全部失效）。

反向错误同样存在：`ResponsiblePersonModal.savePersons`（`ResponsiblePersonModal.ts:27-31`）调用的是 `saveSettings()`，但 `responsiblePersons` 属于 `DataConfig` → **弹窗里添加/删除的负责人重启后丢失**。

**修复**：`settings.*` 的修改必须调用 `this.plugin.saveSettings()`；`config.*` 的修改才调用 `dataConfigService.save()`。建议把 `DataConfigService.save()` 同时落盘 settings，或统一一个 `persistAll()` 入口，避免再次混淆。

### P0-3 DataService `versions:all` 缓存无失效路径；备份恢复后缓存不失效

`src/services/DataService.ts`

- `createVersion`（467 行）、`updateVersion`（524 行）、`deleteVersion`（556 行）、`deleteApp`（379 行）只 invalidate `versions:{appId}`，**从不 invalidate `versions:all`**。
- `updateVersion` 自身先 `getAllVersions()`（573 行起）再改，若命中 30s TTL 内的旧缓存，则基于旧数据写回，同一会话内版本列表/编辑结果与磁盘不一致；`getVersionById` 也会返回旧数据。
- `BackupService.restoreFromContent`（`BackupService.ts:204-330`）恢复后只刷新了 Todo/Category 索引，`apps:all / versions:all / projects:all / project:{id}` 缓存均未失效 → 恢复后 UI 立即刷新看到的是恢复**前**的数据（最长 30s）；此窗口内若执行删除（按旧 name 计算文件名、旧缓存查找文件），可能删到错误文件。
- 迁移（`MigrationService.run`）同样只 invalidate todo/category 索引，不失效 DataService 缓存。

**修复**：所有写操作后统一调用 `cache.invalidate()`（全量或按 key 白名单）；`restoreFromContent`/`migration.run` 结束时调用 `cache.invalidate()`。

---

## 三、P1 — 高优先级功能问题

### P1-1 TodoService / CategoryService 内存索引不监听 vault 事件，外部修改永不过期

`TodoService.ts:92-98`、`CategoryService.ts:54-61`：索引只在启动时构建一次，`loaded` 标记常驻；`invalidateAll()` 仅在迁移/恢复/切负责人时手动调用。**整个项目没有任何 `vault.on('create'|'modify'|'delete')` / `registerEvent`**。用户在 Obsidian 中手工编辑待办文件、Obsidian Sync 从其他设备同步、或 git 拉取后，索引与实际文件永久不一致（直到重载插件）。DataService 缓存有 30s TTL 兜底，但 Todo/Category 索引没有。

**建议**：`onload` 注册 vault 事件（限定 `todos/`、`categories/`、`apps/`、`versions/`、`projects/` 前缀），对应失效缓存/索引，或至少给索引加版本戳 + 周期刷新。

### P1-2 切换 dataPath 只重建 DataService，其余服务残留旧路径状态

`src/main.ts:195-198`：设置 dataPath 后仅 `new DataService(...)`，但：
- `TodoService` 索引（`loaded=true`，按旧路径加载）、`CategoryService` 索引、`DataConfigService.loaded` 均仍指向**旧路径** → 新旧路径数据混杂；
- 旧 `DataService` 实例的 `DataCache` 定时器未 `destroy()`，孤儿 interval 持续运行（微小泄漏）。

**建议**：切换路径后统一调用 `todoService.invalidateAll()`、`categoryService.invalidateAll()`、`dataConfigService.reset()` + `load()`，并 `dataService.cache.destroy()` 旧实例。

### P1-3 ProjectInfoSection 连续保存必然触发版本冲突

`ProjectInfoSection.ts:55-64`：`saveItems` 用 `this.project.version` 作为 expectedVersion，保存成功后只更新 `projectInfo`，**不递增本地 `project.version`**。在同一个 ProjectInfoModal 里连续操作（添加条目 → 再编辑/删除）时，第二次保存的 expectedVersion 落后于磁盘版本，抛 `ConcurrencyConflictError`（提示"并发冲突"）。

**修复**：用 `updateProject` 的返回值同步 `this.project.version`（或省略 expectedVersion）。

### P1-4 AppVersionManageView 版本排序用字符串比较，1.10.0 < 1.9.0

`AppVersionManageView.ts:107-112`：`b.versionNumber.localeCompare(a.versionNumber)`。`DataService.getVersionsByAppId`（399 行）用的是正确的 `compareVersions`，但该视图重新排序后**版本列表顺序错误**（"1.10.0" 排在 "1.9.0" 前面）。

**修复**：改用 `compareVersions`。

### P1-5 parseDateInput 在负 UTC 时区偏移一天

`types.ts:296-412`：`parseDateInput("2026-02-10")` 先走 `new Date(trimmed)`（314 行）→ V8 按 **UTC 零时**解析 → `formatLocalDate` 转本地日期。在 UTC-5 等负时区（美洲用户）会存成 `2026-02-09`。代码只特殊处理了 "2001 年" 的月日格式分支，未处理一般日期的时区回拨。TestPlanModal 全部 8 个日期输入都走此函数（`TestPlanModal.ts:37` 等）。

**修复**：在 `new Date(trimmed)` 分支前先匹配 `YYYY-MM-DD` 正则，用 `parseLocalDate` 解析（`dateUtils.ts:119-132` 已有正确实现）。

### P1-6 待办"到期提醒" setTimeout 溢出 + 提醒不持久化

`TodoTabView.ts:593-613`：`delayMs = dueDate - now`，当截止日期超过约 **24.8 天**（`2^31-1` ms）时 `setTimeout` 立即触发 → 一设置就弹提醒。另外提醒仅存内存（`ReminderService.reminders`），重启后丢失，且不随 dueDate 修改重新调度。

**建议**：`delayMs > 0x7fffffff` 时改为分段调度（先睡 24 天再重算）；如需持久化，可在启动时扫描未完成待办的 dueDate 重建提醒。

### P1-7 切换负责人按钮触发全量索引重建（磁盘重读）

`TodoTabView.ts:400-417`：每次点击"全部/张三/李四"都调用 `todoService.invalidateAll()` → `readAllTodosFromDisk()` 全量扫描重读所有待办文件。索引本来就是全局的，负责人只是查询时过滤（`getAllTodos` 已支持 `currentResponsiblePerson`），无需重建。

**修复**：删除按钮回调里的 `invalidateAll()`，仅 `setCurrentResponsiblePerson + render()`。

---

## 四、P2 — 中优先级问题

| # | 位置 | 问题 |
|---|---|---|
| P2-1 | `TodoTabView.ts:48-112` | `isRendering` 没有 `finally` 复位：渲染中途抛异常后视图永久卡死（后续 render 全部被吞）。 |
| P2-2 | `TodoService.ts:156-189, 398-406` | `searchIndex`/`tokenize`/`indexSearchAdd/Remove` 构建了完整搜索索引但**从未被查询使用**；`searchTodos` 走线性 `includes` 扫描。构建索引的 CPU/内存开销白费，属死代码。 |
| P2-3 | `DualPaneView.ts` 全文件 | 无任何引用，死代码（约 450 行 + 相关样式）。 |
| P2-4 | `DataService.ts:869-889` | `getAllProjects` 为每个项目缓存 `project:{id}`，加上 `apps/versions` 各 key 后，数据量超过 `DataCache.maxEntries=200` 时开始逐出最旧条目，形成缓存抖动（每次访问都重读全量），大库下是性能悬崖。 |
| P2-5 | `TableView.ts:53` | `sortState` 是实例字段，但每次 `renderMainView` 都 `new TableView` → 用户排序在任意一次 refresh/自动刷新后重置。 |
| P2-6 | `AppVersionManageView.ts:298-307` | `getProgressColor` 硬编码旧阶段名（待规划/开发中/测试中/已上线/已归档），与可配置 `progressStages` 不一致，详情面板徽章配色错误。 |
| P2-7 | `MigrationService.ts:127-155, 171-187` | ① 备份目录建在 `{dataPath}` 内部，`oldDataPath === dataPath` 时备份内容随即会被"迁移覆盖"（虽有 warn，但流程自相矛盾）；② 绝对路径模式下 `copyAbsolutePathFolder` 把含绝对路径的 dst 传给 `vault.create`，会在 vault 内生成错误目录结构。 |
| P2-8 | `TodoService.ts:300-310`、`MigrationService.ts:532` | `path.substring(0, path.lastIndexOf('/'))` 在 Windows 绝对路径（反斜杠）下取目录失败 → `mkdirSync('')` 抛错。 |
| P2-9 | `main.ts:42-48` | 迁移在 onload 中 fire-and-forget，与视图首次 `loadData` 并发 → 视图可能读到迁移中途的部分数据（迁移写文件与读取无互斥）。 |
| P2-10 | `CategoryModal.ts:88-115` | 上下移动分类用两次独立 `update` 交换 sortOrder，非原子；第二次失败会导致顺序错乱。 |
| P2-11 | `TodoService.ts:61-70` | `getDataPath()` 默认值 `'workflow-hub'` 与 `FilePathResolver`（`DataService` 侧）默认值 `'app-version-manager'` 不一致，settings.dataPath 为空时两套服务指向不同目录。 |
| P2-12 | `BackupService.ts:128-202 / 204-330` | 回滚逻辑在 `restoreFromBackup` 与 `restoreFromContent` 重复实现两份（约 70 行 × 2），后续修复易漏。 |

---

## 五、性能问题汇总

1. **主包体积 1.31MB（未压缩），xlsx 全量打入**：`esbuild.config.mjs` 未启用 `minify`；`import('xlsx')`（`ImportExportService.ts:260`）在 `format: "cjs"` 下被 esbuild 静态打包进 main.js（已确认 28 处 XLSX 引用）。每次 Obsidian 启动都要解析 ~1.3MB JS。建议：生产构建开启 `minify`；将 xlsx 改为可选/懒加载（拆分或移除 Excel 导出，保留 CSV+JSON）。
2. **启动全量扫描**：`loadAllIndexes` 在 vault 模式下遍历**整个 vault 的所有 markdown 文件**（`TodoService.ts:202`，按前缀过滤）；加上 `MigrationService`/`CategoryService` 同类扫描，库越大启动越慢。
3. **每日智能继承全量写盘**：`TodoInheritanceService.runInheritance`（78-80 行）对每个未完成待办顺序 `update`（写文件 + 版本递增 + updatedAt 变更），数百条待办 = 数百次串行 IO。
4. **视图全量重建**：项目表每次渲染（含 2 分钟自动刷新）都 `containerEl.empty()` 后重建全部行；行内 `getTodoStats` 对每个项目发起查询。条目多时刷新有明显卡顿感。建议按需增量更新或虚拟滚动。
5. **版本行 N+1 查询**：`AppVersionManageView.ts:162` 每个版本行都调 `getAllProjects()`（有缓存兜底，但首次渲染是全量解析）。

---

## 六、测试覆盖缺口

- 全部 152 个测试**只覆盖服务层与纯工具函数**，视图层（TableView/TodoTabView/AppVersionManagerView/modals）零覆盖。
- `DataService.test.ts` / `TodoService.test.ts` 的 mock 中 `isAbsolutePath: () => false` —— **绝对路径分支（文件系统 API 路径）完全无测试**，而该分支恰好是 P0-3、P2-8 等问题的重灾区。
- 缓存失效类 bug（P0-3）、设置持久化（P0-2）、初始化顺序（P0-1）均无回归测试——建议为这三类各补一条单测（例如：createVersion 后 getAllVersions 不返回旧值；settings onChange 后 loadSettings 能读到）。
- 无 `parseDateInput` 跨时区用例（P1-5）、无 `compareVersions` 与 localeCompare 差异用例（P1-4）。

---

## 七、修复优先级建议

| 批次 | 内容 | 说明 |
|---|---|---|
| 第一批（阻断发布） | P0-1 初始化顺序；P0-2 设置持久化归位 | 修复后插件才能正常启用、设置才能保存 |
| 第二批（数据一致性） | P0-3 缓存失效统一；P1-1 vault 事件监听或索引刷新；P1-3 版本号同步 | 消除"看到旧数据 / 写回旧数据"风险 |
| 第三批（明显功能缺陷） | P1-4 版本排序；P1-5 时区；P1-6 提醒溢出；P1-2 切路径状态清理；P1-7 负责人切换性能 | |
| 第四批（清理优化） | P2 各项 + 死代码清理（DualPaneView、searchIndex）+ 构建 minify + 补回归测试 | |

---

## 附：本次验证记录

- `npx tsc -noEmit -skipLibCheck` → 0 错误
- `npm run test`（vitest）→ 8 个文件 152 用例全部通过
- `main.js` 构建产物：1,312,817 字节（2026-08-02 14:33，未压缩，含 xlsx）
- 确认 main.js 中同样存在 P0-1 的初始化顺序（43340-43341 行），即当前部署版本带病

---

## 附 2：修复验证记录（2026-08-02 21:57）

评审问题已全部修复并通过验证，修复明细如下：

| 评审项 | 修复内容 |
|---|---|
| P0-1 初始化顺序 | `main.ts`：`dataService` 先创建，`dataConfigService.load()` 后移 |
| P0-2 设置持久化 | `main.ts`：8 项插件设置恢复 `saveSettings()`；config 类设置统一 `dataConfigService.save()`；`ResponsiblePersonModal` 同步修正 |
| P0-3 缓存失效 | `DataService`：create/update/deleteVersion、deleteApp 均失效 `versions:all`（deleteApp 额外失效 `versions:{appId}`）；`BackupService.restoreFromContent`、`MigrationService.run` 完成后失效全部 DataService 缓存 |
| P1-1 vault 事件同步 | `TodoService`/`CategoryService`：`registerVaultEvents` 重写 —— 自身写入（`selfWriteDepth` 计数）跳过、300ms 防抖合并批量变更、目录前缀动态获取（切路径仍有效）、新增 `unregisterVaultEvents`（`main.ts onunload` 调用，防热重载监听器累积） |
| P1-2 切路径状态 | `main.ts`：切换 dataPath 时销毁旧 DataService 缓存定时器；配合动态前缀事件监听 |
| P1-3~P1-7、P2-1~P2-12 | 均按评审建议修复（详见上文） |
| 旧配置迁移（评审补充项） | `DataConfigService`：配置文件不存在时自动从旧版 plugin data 迁移 `progressStages`/`responsiblePersons`/`defaultTodos`/`tableColumns`/`preReleaseRound`/`defaultCategoryId`/`defaultAppId` 到 `.workflow-hub-config.json`，并清理旧字段避免重复迁移 |
| 构建优化 | `esbuild.config.mjs`：生产构建开启 `minify` → main.js 1,312,668 → **678,435 字节（-48%）** |
| 回归测试 | 新增 12 个用例：DataService 版本缓存失效 ×4、`parseDateInput` 时区 ×1、DataConfigService 迁移 ×4、vault 事件（外部防抖重建/自写跳过/注销）×3 |

**最终验证**：`tsc` 0 错误；`vitest` 9 个文件 **164/164** 通过（原 152 + 新增 12）；`npm run lint` 0 error；`npm run build` 成功并生成压缩产物。
