# 数据迁移脚本

## 概述

`migrate.ts` 是一个独立的 Node.js 数据迁移脚本，用于将旧版 AVM (app-version-manager) 数据和 todolist tasks.json 迁移到新版 obsidian-workflow-hub 格式。

## 功能特性

- ✅ **完整迁移**：支持 AVM apps/versions/projects/todos + todolist tasks.json
- ✅ **数据备份**：迁移前自动备份原始数据到 `_migration_backup_{timestamp}/`
- ✅ **时间戳转换**：自动将毫秒时间戳、`YYYY-MM-DD HH:MM` 等格式转为 ISO 8601 UTC
- ✅ **字段映射**：完整映射所有字段（projectInfo、appVersionLinks、progressHistory 等）
- ✅ **安全校验**：迁移后自动统计并校验数据完整性
- ✅ **dry-run 模式**：可预览迁移结果而不实际写入
- ✅ **详细日志**：生成迁移日志文件 `_migration_{timestamp}.log`
- ✅ **错误处理**：遇到异常数据不中断，记录警告并继续

## 使用方法

### 前置条件

- Node.js >= 16
- 安装 ts-node: `npm install -g ts-node` 或项目本地有 TypeScript

### 基本用法

```bash
# 在 vault 目录下运行（默认从当前目录找 vault）
npx ts-node scripts/migrate.ts --vault ~/ObsidianVault

# 预览模式（不写入任何文件）
npx ts-node scripts/migrate.ts --vault ~/ObsidianVault --dry-run

# 自定义路径
npx ts-node scripts/migrate.ts \
  --vault ~/ObsidianVault \
  --old-data app-version-manager \
  --new-data workflow-hub \
  --todolist .obsidian/plugins/todolist/tasks.json

# 跳过备份（如果已经手动备份过）
npx ts-node scripts/migrate.ts --vault ~/ObsidianVault --skip-backup
```

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--vault <path>` | Obsidian vault 路径 | 当前目录 |
| `--old-data <path>` | 旧 AVM 数据路径（相对 vault 或绝对路径） | `app-version-manager` |
| `--new-data <path>` | 新数据路径（相对 vault 或绝对路径） | `workflow-hub` |
| `--todolist <path>` | todolist tasks.json 路径 | `.obsidian/plugins/todolist/tasks.json` |
| `--dry-run` | 仅预览，不写入任何文件 | `false` |
| `--skip-backup` | 跳过备份步骤 | `false` |
| `--help` | 显示帮助 | - |

## 迁移规则

### 1. AVM Apps (`app-version-manager/apps/*.md` → `workflow-hub/apps/*.md`)

| 旧字段 | 新字段 | 转换规则 |
|--------|--------|----------|
| `id` | `id` | 直接复制（UUID） |
| `name` | `name` | 直接复制 |
| `createdAt` (毫秒) | `createdAt` | `toISO()` → ISO 8601 |
| `updatedAt` (毫秒) | `updatedAt` | `toISO()` → ISO 8601 |
| `version` | `version` | 直接复制 |

### 2. AVM Versions (`app-version-manager/versions/*.md` → `workflow-hub/versions/*.md`)

| 旧字段 | 新字段 | 转换规则 |
|--------|--------|----------|
| `id` | `id` | 直接复制 |
| `appId` | `appId` | 直接复制 |
| `versionNumber` | `versionNumber` | 直接复制 |
| `bllVersion` | `bllVersion` | 直接复制 |
| `ippVersion` | `ippVersion` | 直接复制 |
| `webVersion` | `webVersion` | 直接复制 |
| `updateContent` | `updateContent` | 直接复制 |
| `isArchived` | `isArchived` | 直接复制 |
| `createdAt` (毫秒) | `createdAt` | `toISO()` |
| `updatedAt` (毫秒) | `updatedAt` | `toISO()` |
| `version` | `version` | 直接复制 |

### 3. AVM Projects (`app-version-manager/projects/*.md` → `workflow-hub/projects/*.md`)

| 旧字段 | 新字段 | 转换规则 |
|--------|--------|----------|
| `id` | `id` | 直接复制 |
| `name` | `name` | 直接复制 |
| `appVersionLinks` | `appVersionLinks` | 直接复制（已是数组格式） |
| `manager` | `manager` | 直接复制 |
| `responsiblePerson` | `responsiblePerson` | 直接复制 |
| `projectLink` | `projectLink` | 直接复制 |
| `componentLink` | `componentLink` | 直接复制 |
| `features` | `features` | 直接复制 |
| `spec` | `spec` | 直接复制 |
| `requirements` | `requirements` | 直接复制 |
| `progress` | `progress` | 直接复制 |
| `progressHistory` | `progressHistory` | 毫秒时间戳 → ISO 8601 |
| `b*TestTime` | `b*TestTime` | 保持 `YYYY-MM-DD` 不转 ISO |
| `actualReleaseTime` | `actualReleaseTime` | 保持 `YYYY-MM-DD` |
| （新增） | `projectInfo` | `[]`（空数组） |
| `createdAt` (毫秒) | `createdAt` | `toISO()` |
| `updatedAt` (毫秒) | `updatedAt` | `toISO()` |
| `version` | `version` | 直接复制 |

### 4. AVM Todos (`app-version-manager/projects/todos__{projectId}.md` → `workflow-hub/todos/*.md`)

| 旧字段 | 新字段 | 转换规则 |
|--------|--------|----------|
| `id` | `id` | 直接复制 |
| `content` | `content` | 直接复制 |
| `link` | `link` | 直接复制 |
| `dueDate` | `dueDate` | 保持 `YYYY-MM-DD` |
| `priority` | `priority` | 直接复制（high/medium/low） |
| `completed` (boolean) | `status` | `false`→`todo`, `true`→`done` |
| `completed` (boolean) | `completedAt` | `true`→`toISO(createdAt)`, `false`→`''` |
| `createdAt` | `createdAt` | 已是 ISO → 直接复制 |
| `updatedAt` | `updatedAt` | 已是 ISO → 直接复制 |
| （新增） | `pinned` | `false` |
| （新增） | `categoryId` | `null` |
| （新增） | `projectId` | 从文件名 `todos__{projectId}.md` 提取 |
| （新增） | `responsiblePerson` | `''` |
| （新增） | `version` | `1` |

### 5. todolist tasks.json (`.obsidian/plugins/todolist/tasks.json` → `workflow-hub/todos/*.md`)

| 旧字段 | 新字段 | 转换规则 |
|--------|--------|----------|
| `taskId` | `id` | 直接复制 |
| `content` | `content` | 直接复制（保留 #tag） |
| `link` | `link` | 直接复制 |
| `dueDate` | `dueDate` | 直接复制（已是 YYYY-MM-DD） |
| `priority` | `priority` | `high/medium/low` → 直接；其他 → `''` |
| `completed` (boolean) | `status` | `false`→`todo`, `true`→`done` |
| `completed` (boolean) | `completedAt` | `true`→`toISO(createAt)`, `false`→`''` |
| `createAt` | `createdAt` | `YYYY-MM-DD HH:MM` → ISO 8601 |
| `createAt` | `updatedAt` | 同 `createdAt` |
| （新增） | `pinned` | `false` |
| （新增） | `categoryId` | `null` |
| （新增） | `projectId` | `null` |
| （新增） | `responsiblePerson` | `''` |
| （新增） | `version` | `1` |

### 丢弃的数据

- AVM `plans/` 目录 → 丢弃（规划功能已移除）
- AVM `memos/` 目录 → 丢弃（改用 projectInfo 字段）
- todolist 临时待办/提醒 → 丢弃（纯内存特性）

## 安全机制

1. **自动备份**：迁移前将原始数据完整复制到 `_migration_backup_{timestamp}/`
2. **dry-run 模式**：先预览再执行
3. **错误隔离**：单条数据失败不影响其他数据迁移
4. **自检校验**：迁移后统计数量并检查是否有致命错误
5. **日志记录**：所有操作记录到 `_migration_{timestamp}.log`

## 故障排除

### 迁移失败

1. 检查日志文件 `_migration_{timestamp}.log`
2. 从备份恢复：`_migration_backup_{timestamp}/`
3. 修复源数据后重新运行

### 数据校验

```bash
# 检查新数据目录结构
ls -la workflow-hub/
ls -la workflow-hub/apps/
ls -la workflow-hub/versions/
ls -la workflow-hub/projects/
ls -la workflow-hub/todos/
```

## 注意事项

- 日期字段（`dueDate`、`b*TestTime`、`actualReleaseTime`）保持 `YYYY-MM-DD` 格式，**不**转 ISO
- 时间字段（`createdAt`、`updatedAt`、`completedAt`）统一转 ISO 8601 UTC
- 迁移来的待办默认 `categoryId: null`（未分类）
- 迁移来的待办默认 `projectId: null`（独立待办，todolist）或绑定原项目（AVM）
- 分类实体不由迁移脚本创建，插件首次启动时由 `CategoryService.initializeDefaults()` 初始化
