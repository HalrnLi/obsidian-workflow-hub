# 架构概述

## 分层结构

```
┌─────────────────────────────────────────┐
│  View Layer (src/view/)                 │
│  Obsidian ItemView, Modals, Components  │
├─────────────────────────────────────────┤
│  Service Layer (src/services/)          │
│  DataService, TodoService, Category...  │
├─────────────────────────────────────────┤
│  Utils Layer (src/utils/)               │
│  FilePathResolver, typeGuards, parse...  │
├─────────────────────────────────────────┤
│  Obsidian API / Filesystem              │
└─────────────────────────────────────────┘
```

## 核心服务

| 服务 | 职责 |
|---|---|
| `DataService` | 项目/APP/版本的 CRUD、文件 I/O、缓存 |
| `TodoService` | 待办 CRUD、多维索引（分类/项目/状态/日期/搜索） |
| `CategoryService` | 待办分类 CRUD、默认分类初始化 |
| `MigrationService` | 首次加载时迁移旧数据 |
| `BackupService` | 定时自动备份 |
| `ReminderService` | 预发布提醒调度 |
| `TodoInheritanceService` | 项目待办继承/同步 |

## 路径解析

`FilePathResolver` (src/utils/FilePathResolver.ts) 统一处理相对/绝对路径：
- 相对路径 → Obsidian vault API（`vault.create/read/modify/delete`）
- 绝对路径 → Node.js `fs` 模块
- Windows UNC 路径特殊处理（不经过 `normalizePath`）

## 数据流

1. 用户操作触发 View 事件
2. View 调用对应 Service 方法
3. Service 通过 FilePathResolver 定位文件
4. 读写 Markdown + frontmatter（`parseFrontmatter`/`createFrontmatter`）
5. 使用 `typeGuards` 进行运行时类型校验
6. 更新内存索引/缓存，刷新 View

## 缓存策略

- `DataCache` (src/utils/DataCache.ts) — 30 秒 TTL 内存缓存
- 写操作后即时失效对应缓存键
- 热路径：`getAllApps` / `getAllVersions` / `getAllProjects`

## 并发控制

实体 `version` 字段实现乐观锁。更新时传入 `expectedVersion`，不匹配则抛出 `ConcurrencyConflictError`。

## 事件通信

- `app.workspace.trigger('app-version-manager:create-version')` — 创建版本
- `app.workspace.trigger('app-version-manager:create-project')` — 创建项目
- `plugin.notifyViewsToRefresh()` — 提醒服务回调刷新视图
