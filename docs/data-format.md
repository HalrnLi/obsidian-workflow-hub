# 数据格式规范 (Frontmatter Schema)

所有数据以 **Markdown + YAML frontmatter** 存储在 Obsidian vault 中，文件命名 `{name}__{id}.md`。

## 目录结构

```
<dataPath>/
├── apps/         # APP 定义
├── versions/     # 版本定义（文件名: {appName}_{versionNum}__{id}.md）
├── projects/     # 项目定义
├── todos/        # 待办（文件名: {content前20字符}__{id}.md）
└── categories/   # 待办分类
```

## Entity Schemas

### App
```yaml
id: <uuid>
name: <string>
createdAt: <ISO 8601>
updatedAt: <ISO 8601>
version: <integer>      # 乐观锁版本号
```

### Version
```yaml
id: <uuid>
appId: <uuid>           # 关联 App
versionNumber: <string> # 语义化版本，如 "1.0.0"
bllVersion: <string>
ippVersion: <string>
webVersion: <string>
updateContent: <string>
isArchived: <boolean>
createdAt: <ISO 8601>
updatedAt: <ISO 8601>
version: <integer>
```

### Project
```yaml
id: <uuid>
name: <string>
appVersionLinks:        # 多对多关联 APP+版本
  - appId: <uuid>
    versionId: <uuid>
manager: <string>
responsiblePerson: <string>
projectLink: <string>
componentLink: <string>
features: <string>
spec: <string>
requirements: <string>
progress: <string>      # 当前进度阶段名
progressHistory:        # 格式: "progress@ISO时间"
  - "需求分解@2026-01-01T00:00:00Z"
b1IntegrationTestTime: <ISO date>
b1SystemTestTime: <ISO date>
# ... b2-b4 同理
actualReleaseTime: <ISO date>
projectInfo:            # 项目备忘录条目
  - description: <string>
    link: <string>
createdAt: <ISO 8601>
updatedAt: <ISO 8601>
version: <integer>
```

### Todo
```yaml
id: <uuid>
content: <string>
link: <string>
dueDate: <ISO date>
priority: <high|medium|low|''>
status: <todo|done>
pinned: <boolean>
categoryId: <uuid|null>
projectId: <uuid|null>
completedAt: <ISO 8601>
createdAt: <ISO 8601>
updatedAt: <ISO 8601>
version: <integer>
```

### Category
```yaml
id: <uuid>
name: <string>
sortOrder: <integer>
color: <hex>            # 如 "#ef4444"
createdAt: <ISO 8601>
updatedAt: <ISO 8601>
version: <integer>
```

## 约束

- 所有时间戳统一 ISO 8601 UTC
- `version` 字段用于乐观并发控制，每次写入 +1
- 文件命名使用 `sanitizeFileName()` 处理特殊字符
- 删除 App/Version 时自动清理项目中关联的 `appVersionLinks`
