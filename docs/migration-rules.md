# 数据迁移规则 — obsidian-workflow-hub

> 本文档描述从 **todolist** + **APP_Version_Manager (AVM)** 旧数据迁移到 **obsidian-workflow-hub** 新数据格式的完整规则。
> AI 可直接依据本规则执行数据转换。对应实现见 `src/services/MigrationService.ts`。

---

## 1. 迁移总览

| 源 | 目标 | 处理方式 |
|----|------|----------|
| todolist `tasks.json` | 新 Todo 文件（每个 task 一个 .md，无项目绑定） | 逐条迁移，见 §4 |
| AVM `projects/todos__{projectId}.md` 中的 todos 数组 | 新 Todo 文件（每个 todo 一个 .md，绑定项目） | 逐条迁移，见 §5 |
| AVM `apps/*.md` | 新 `apps/*.md` | 字段不变，时间戳转 ISO，见 §6 |
| AVM `versions/*.md` | 新 `versions/*.md` | 字段不变，时间戳转 ISO，见 §6 |
| AVM `projects/*.md`（非 todos__） | 新 `projects/*.md` | 字段不变 + 新增 `projectInfo: []`，时间戳转 ISO，见 §6 |
| AVM `plans/*.md` | **丢弃** | 规划功能已移除 |
| AVM `memos/*.md` | **丢弃** | 备忘录功能移除（项目级信息改用 projectInfo 字段） |
| AVM Settings | 新 Settings | 字段映射，见 §7 |
| todolist 临时待办/提醒 | **丢弃** | 纯内存特性，重启即失 |

**迁移触发**：插件首次加载时检查 `settings.migrationCompleted`，为 `false` 则执行 `MigrationService.run()`。

**迁移前备份**：旧数据完整拷贝到 `{newDataPath}/_migration_backup_{timestamp}/`（含 `avm/` 和 `todolist/`）。

---

## 2. 数据源路径

- **todolist tasks.json**：`<vault>/.obsidian/plugins/todolist/tasks.json`
- **AVM 旧数据**：`<vault>/{oldDataPath}/`，默认 `oldDataPath = 'app-version-manager'`
- **新数据**：`<vault>/{settings.dataPath}/`，默认 `settings.dataPath = 'workflow-hub'`

新数据目录结构：
```
workflow-hub/
├── apps/          {name}__{id}.md
├── versions/      {appName}_{versionNumber}__{id}.md
├── projects/      {name}__{id}.md
├── todos/         {content前20字符}__{id}.md   ← 每个待办独立文件
└── categories/    {name}__{id}.md
```

---

## 3. 统一命名约定（全局适用）

| 约定项 | 规则 |
|--------|------|
| 时间字段命名 | `createdAt` / `updatedAt`（正确拼写；todolist 的 `createAt` 是 typo，迁移时修正） |
| 时间戳格式 | **ISO 8601 UTC**：`2026-07-22T08:30:00.000Z`（`new Date().toISOString()`） |
| 日期字段（无时间） | `YYYY-MM-DD`，如 `dueDate: "2026-07-25"`（保持不变，不转 ISO） |
| 字符串空值 | `''`（空字符串） |
| 可选关联 ID 空值 | `null`（如 `projectId: null`） |
| 数组空值 | `[]` |
| 主键 | `id: string`（UUID v4） |
| 乐观锁 | `version: number`（初始 1） |
| 文件命名 | `{sanitizeFileName(name)}__{id}.md` |

---

## 4. todolist tasks.json → 新 Todo 文件

### 4.1 源结构

文件：`<vault>/.obsidian/plugins/todolist/tasks.json`

```json
{
  "version": "1.2.0",
  "tasks": [
    {
      "date": "2026-07-20",
      "createTime": "2026-07-20 09:30",
      "tasksList": [
        {
          "taskId": "uuid-xxx",
          "content": "完成登录接口 #工作 #后端",
          "completed": false,
          "createAt": "2026-07-20 09:30",
          "link": "https://git.example.com/pr/123",
          "dueDate": "2026-07-25",
          "priority": "high"
        }
      ]
    }
  ],
  "lastModified": "2026-07-22T08:00:00.000Z"
}
```

遍历 `data.tasks[].tasksList[]`，每个 task 生成一个新 Todo 文件。

### 4.2 逐字段映射

| 源字段 | 目标字段 | 转换规则 | 边界情况 |
|--------|----------|----------|----------|
| `task.taskId` | `id` | 直接复制 | 空/非 UUID → `generateId()` 重新生成 |
| `task.content` | `content` | **原样复制**（保留 #tag，不剥离） | 空 → 跳过该条并记录警告 |
| `task.link` | `link` | 复制 | `null`/`undefined` → `''` |
| `task.dueDate` | `dueDate` | 复制（已是 YYYY-MM-DD） | `null`/空/格式不符 → `''` |
| `task.priority` | `priority` | `'high'`/`'medium'`/`'low'` 原样；`null`/`undefined`/`'none'` → `''` | 非法值 → `''` + 警告 |
| `task.completed` | `status` | `false` → `'todo'`；`true` → `'done'` | 非布尔 → `'todo'` |
| `task.completed` | `completedAt` | `true` → 用 `toISO(task.createAt)`（best effort）；`false` → `''` | todolist 不记录完成时间 |
| （无） | `categoryId` | `null`（未分类） | 迁移来的待办默认未分类 |
| （无） | `projectId` | `null`（未绑定项目） | todolist 无项目概念 |
| `task.createAt` | `createdAt` | `toISO()`：`YYYY-MM-DD HH:MM` → ISO（见 §8） | - |
| （无） | `updatedAt` | 用 `createdAt` 兜底（todolist 无更新时间） | - |
| （无） | `version` | `1` | - |

### 4.3 #tag 处理

- **保留原文本不动**，#tag 自然留在 `content` 中
- 不剥离、不转换为分类
- 理由：Obsidian 原生识别 #tag，用户在 Obsidian 全局搜索仍可用；新系统的"分类"是独立维度，与 #tag 互不影响

### 4.4 不保留的字段

- `dateTask.date`（日期分组）：新模型用 `createdAt` 表达创建时间，不需要按日期分组
- `lastModified`：新模型用每个 Todo 的 `updatedAt`

### 4.5 迁移后文件路径

`{newDataPath}/todos/{sanitizeFileName(content.slice(0,20))}__{id}.md`

---

## 5. AVM Todo → 新 Todo 文件

### 5.1 源结构

文件：`{oldDataPath}/projects/todos__{projectId}.md`（每个文件 frontmatter 含 `todos: [...]` 数组）

```yaml
---
todos: [
  {
    "id": "todo-uuid",
    "content": "编写测试用例",
    "link": "",
    "dueDate": "2026-07-28",
    "completed": false,
    "testStageRef": "b1SystemTestTime",
    "projectId": "proj-uuid",
    "createdAt": "2026-07-15T10:00:00.000Z",
    "updatedAt": "2026-07-20T14:30:00.000Z",
    "version": 2
  }
]
---
```

遍历每个 `todos__*.md` 的 `todos` 数组，每个元素生成一个新 Todo 文件。

### 5.2 逐字段映射

| 源字段 | 目标字段 | 转换规则 | 边界情况 |
|--------|----------|----------|----------|
| `todo.id` | `id` | 直接复制 | 空 → `generateId()` |
| `todo.content` | `content` | 复制 | 空 → 跳过 + 警告 |
| `todo.link` | `link` | 复制 | `null`/`undefined` → `''` |
| `todo.dueDate` | `dueDate` | 复制 | `null`/空 → `''` |
| （无） | `priority` | `''`（AVM Todo 无优先级字段） | - |
| `todo.completed` | `status` | `false` → `'todo'`；`true` → `'done'` | - |
| `todo.completed` | `completedAt` | `true` → `toISO(todo.updatedAt)`；`false` → `''` | - |
| （无） | `categoryId` | `null`（未分类） | - |
| `todo.projectId` | `projectId` | 直接复制（保留项目绑定） | 对应项目不存在 → 仍保留（允许孤立），记录警告 |
| `todo.createdAt` | `createdAt` | `toISO()`（若已是 ISO 则原样） | - |
| `todo.updatedAt` | `updatedAt` | `toISO()` | - |
| `todo.version` | `version` | 直接复制 | 空 → `1` |
| `todo.testStageRef` | **丢弃** | 不迁移 | AVM 特有字段，新模型不需要 |

### 5.3 迁移后

原 `todos__{projectId}.md` 文件不复制到新目录（已拆分为独立 Todo 文件）。

---

## 6. AVM App/Version/Project → 新格式

### 6.1 App

- 字段不变，仅时间戳转换：`createdAt`/`updatedAt` 用 `toISO()`（AVM 用 `Date.now().toString()` 毫秒字符串）
- 文件名不变：`{name}__{id}.md`
- 复制到 `{newDataPath}/apps/`

### 6.2 Version

- 字段不变，时间戳转 ISO
- 文件名不变
- 复制到 `{newDataPath}/versions/`

### 6.3 Project

- 字段不变 + **新增 `projectInfo: []`**（空数组，用户后续手动添加条目）
- 时间戳转 ISO：`createdAt`/`updatedAt`
- `progressHistory[].changedAt` 转 ISO（AVM 用 `Date.now().toString()`）
- 日期字段（`b*TestTime`、`actualReleaseTime`）**保持 YYYY-MM-DD 不变**
- 文件名不变
- 复制到 `{newDataPath}/projects/`

**ProjectInfoItem 结构**（projectInfo 数组元素）：
```typescript
{ description: string; link: string }  // description 必填，link 可空
```

---

## 7. Settings 迁移

源：AVM 插件 `loadData()` 返回的对象。

| 源字段 | 目标字段 | 转换规则 |
|--------|----------|----------|
| `defaultAppId` | `defaultAppId` | 直接复制 |
| `autoBackup` | `autoBackup` | 直接复制 |
| `backupDay` | `backupDay` | 直接复制 |
| `backupHour` | `backupHour` | 直接复制 |
| `lastBackupTime` | `lastBackupTime` | 直接复制 |
| `dataPath` | `dataPath` | 若为 `'app-version-manager'` → 改为 `'workflow-hub'`；其他保留 |
| `backupPath` | `backupPath` | 直接复制 |
| `progressStages` | `progressStages` | 直接复制 |
| `overdueWarningDays` | `overdueWarningDays` | 直接复制 |
| `autoRefreshInterval` | `autoRefreshInterval` | 直接复制 |
| `responsiblePersons` | `responsiblePersons` | 直接复制 |
| `preReleaseRound` | `preReleaseRound` | 直接复制 |
| `defaultTodos` | `defaultTodos` | 直接复制 |
| （无） | `defaultCategoryId` | `null` |
| （无） | `migrationCompleted` | `true`（迁移完成后置位） |

---

## 8. 时间戳统一转换规则

**目标格式**：ISO 8601 UTC，如 `2026-07-22T08:30:00.000Z`

实现：`src/utils/dateUtils.ts` 的 `toISO(value)` 函数。

| 源格式 | 识别特征 | 转换规则 | 示例 |
|--------|----------|----------|------|
| 毫秒时间戳字符串 | `/^\d{13}$/`（13 位数字） | `new Date(Number(value)).toISOString()` | `"1753188600000"` → `"2025-07-22T..."` |
| ISO 8601 | `/^\d{4}-\d{2}-\d{2}T/` | 原样返回 | `"2026-07-15T10:00:00.000Z"` → 原样 |
| `YYYY-MM-DD HH:MM`（todolist） | `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/` | 当作本地时间 → `new Date(y, mo-1, d, h, mi).toISOString()` | `"2026-07-20 09:30"` → `"2026-07-20T01:30:00.000Z"`（UTC+8） |
| `YYYY-MM-DD HH:MM:SS` | `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/` | 当作本地时间 → ISO | 同上带秒 |
| `YYYY-MM-DD`（日期） | `/^\d{4}-\d{2}-\d{2}$/` | 当作本地 00:00 → ISO | `"2026-07-20"` → `"2026-07-19T16:00:00.000Z"`（UTC+8） |
| 空字符串 / null | `!value` | 返回 `''` | `""` → `""` |
| 无法识别 | - | 警告 + `new Date().toISOString()` 兜底 | - |

**关键点**：
- AVM `DataService` 的 `createdAt` 用 `Date.now().toString()`（毫秒）→ 转 ISO
- AVM `TodoService` 的 `createdAt` 已是 ISO → 原样
- todolist 的 `createAt` 用 `YYYY-MM-DD HH:MM` → 转 ISO
- `progressHistory[].changedAt`（AVM 用毫秒）→ 转 ISO
- **日期字段**（`dueDate`、`b*TestTime`、`actualReleaseTime`）保持 `YYYY-MM-DD`，**不转 ISO**

---

## 9. ID 规则

- **保留原 ID**：todolist 的 `taskId`、AVM Todo 的 `id`、AVM App/Version/Project 的 `id` 都是 UUID，直接复制
- 边界：
  - ID 为空/非字符串 → `generateId()` 重新生成
  - ID 冲突（同 ID 不同内容）→ 后者覆盖前者 + 警告（UUID 冲突概率极低）
- 分类 ID：迁移时不创建分类实体；默认分类（工作/学习/生活）由 `CategoryService.initializeDefaults()` 在插件首次启动时创建

---

## 10. 默认分类规则

- 迁移来的所有待办 `categoryId: null`（未分类）
- 不强制猜测分类
- 迁移后用户可在"待办"Tab 手动归类
- 插件首次启动时（迁移完成后）由 `CategoryService` 初始化默认分类：
  - 工作（sortOrder: 0）
  - 学习（sortOrder: 1）
  - 生活（sortOrder: 2）
- "未分类"不是实体，由 `categoryId: null` 表示，UI 单独渲染页签

---

## 11. 迁移执行步骤（供 AI 执行）

如需手动执行迁移（而非依赖插件自动迁移），按以下步骤：

1. **备份**：将 `<vault>/app-version-manager/` 整目录复制到 `<vault>/workflow-hub/_migration_backup_{timestamp}/avm/`；将 `<vault>/.obsidian/plugins/todolist/tasks.json` 复制到 `.../todolist/tasks.json`

2. **迁移 AVM 实体**：
   - 遍历 `<vault>/app-version-manager/apps/*.md`，按 §6.1 转换时间戳，写入 `<vault>/workflow-hub/apps/`
   - 遍历 `<vault>/app-version-manager/versions/*.md`，按 §6.2 转换，写入 `<vault>/workflow-hub/versions/`
   - 遍历 `<vault>/app-version-manager/projects/*.md`（**排除 `todos__*.md`**），按 §6.3 转换（加 `projectInfo: []`），写入 `<vault>/workflow-hub/projects/`

3. **迁移 AVM 待办**：
   - 遍历 `<vault>/app-version-manager/projects/todos__*.md`
   - 解析 frontmatter 的 `todos` 数组
   - 每个 todo 按 §5.2 转换，写入 `<vault>/workflow-hub/todos/{name}__{id}.md`

4. **迁移 todolist**：
   - 读取 `<vault>/.obsidian/plugins/todolist/tasks.json`
   - 遍历 `data.tasks[].tasksList[]`
   - 每个 task 按 §4.2 转换，写入 `<vault>/workflow-hub/todos/{name}__{id}.md`

5. **迁移 Settings**：按 §7 映射，置 `migrationCompleted: true`，`dataPath` 改为 `workflow-hub`

6. **丢弃**：`plans/`、`memos/` 目录不复制

7. **自检**：
   - 统计迁移的 App/Version/Project/Todo 数量
   - 与源数据数量对比
   - 数量不一致 → 从备份恢复
   - 写迁移日志到 `<vault>/workflow-hub/_migration_{timestamp}.log`

---

## 12. 新 Todo frontmatter 样例

```yaml
---
id: "todo-uuid"
content: "完成登录接口文档"
link: "https://git.example.com/pr/123"
dueDate: "2026-07-25"
priority: "high"
status: "in-progress"
categoryId: "cat-work-uuid"
projectId: "proj-uuid"
createdAt: "2026-07-20T01:30:00.000Z"
updatedAt: "2026-07-22T06:30:00.000Z"
completedAt: ""
version: 2
---
```

## 13. 新 Project frontmatter 样例（含 projectInfo）

```yaml
---
id: "proj-uuid"
name: "登录模块重构"
versionId: "ver-uuid"
manager: "张三"
responsiblePerson: "李四"
projectLink: "https://git.example.com/proj"
componentLink: "https://git.example.com/comp"
features: "支持扫码登录"
spec: "见设计文档"
requirements: "需求A；需求B"
progress: "已提测"
progressHistory: ["需求分解@2026-01-01T00:00:00.000Z","已提测@2026-03-01T00:00:00.000Z"]
b1IntegrationTestTime: "2026-02-10"
b1SystemTestTime: "2026-02-15"
b2IntegrationTestTime: "2026-03-01"
b2SystemTestTime: "2026-03-05"
b3IntegrationTestTime: ""
b3SystemTestTime: ""
b4IntegrationTestTime: ""
b4SystemTestTime: ""
actualReleaseTime: ""
projectInfo: [{"description":"架构决策记录","link":"https://wiki.example.com/adr"},{"description":"接口文档","link":""}]
createdAt: "2026-01-01T00:00:00.000Z"
updatedAt: "2026-07-22T08:00:00.000Z"
version: 5
---
```
