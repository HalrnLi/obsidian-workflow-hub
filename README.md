# obsidian-workflow-hub（工作流中心）

> Obsidian 插件：**项目版本管理 + 全局待办与分类管理**。
>
> 合并自 [APP_Version_Manager](../APP_Version_Manager)（版本/项目管理）与 [todolist](../todolist)（独立待办），以 AVM 架构为基座重构，统一数据模型与存储层。

## 核心功能

### 项目版本管理（沿用 AVM）
- 多 App / 多版本 / 多项目管理
- 双栏视图（版本列表 + 项目卡片）+ 表格视图
- 项目进度状态机（7 阶段，可自定义）
- 已发布项目独立 Tab 展示
- 提测计划时间（B1-B4 集成/系统测试）、预发布提醒
- 数据导入导出、自动备份

### 全局待办与分类（新增，合并自 todolist）
- **待办 Tab**：主界面顶级页签，分类页签 + 筛选 + 列表
- **分类管理**：用户自定义 CRUD，初始默认分类（工作/学习/生活）；单选主分类
- **待办可绑定项目**（可选）：在项目详情面板查看/管理该项目待办；也可不绑定作为独立待办
- **三态状态机**：待办 / 进行中 / 已完成（替代布尔 completed）
- 优先级（高/中/低）、截止日期、关联链接
- 多维内存索引：按分类/项目/状态/截止日期/全文搜索（中文 2-gram 分词）
- 每个待办独立 frontmatter 文件，Obsidian 原生可读可搜索

### 项目信息条目区（新增）
- 每个项目可添加多条「描述 + 可选链接」信息条目（项目备忘录，非待办）
- 嵌入项目详情面板，可增删改

## 视图结构

主界面三个 Tab：
- **项目**：双栏视图 / 表格视图（点击项目卡片展开详情面板）
- **待办**：分类页签 + 筛选 + 待办列表
- **已发布**：已发布项目独立展示

项目详情面板：基本信息 + 项目信息条目区 + 项目待办区。

## 数据存储

- 全部数据用 **Markdown + YAML frontmatter**（Obsidian 原生可读可搜索可同步）
- 存储路径：`<vault>/workflow-hub/`（可在设置中修改）
- 目录：`apps/` `versions/` `projects/` `todos/` `categories/`
- 文件命名：`{name}__{id}.md`
- 时间戳统一 ISO 8601 UTC；字段命名 `createdAt`/`updatedAt`

## 数据迁移

首次加载时自动检测并迁移旧数据（todolist `tasks.json` + AVM 旧数据）。

- 迁移规则详见 **[docs/migration-rules.md](docs/migration-rules.md)**
- 迁移前自动备份到 `workflow-hub/_migration_backup_{timestamp}/`
- 迁移日志：`workflow-hub/_migration_{timestamp}.log`
- 迁移完成后置 `settings.migrationCompleted = true`，避免重复迁移

迁移要点：
- todolist 待办 → 无项目绑定的待办（保留原 #tag 文本）
- AVM 项目内待办 → 绑定项目的待办
- AVM 规划(plans) / 备忘录(memos) → 丢弃
- 时间戳统一转 ISO，字段拼写统一为 `createdAt`

## 开发

```bash
npm install      # 安装依赖
npm run dev      # 监听模式构建
npm run build    # 类型检查 + 生产构建
npm test         # 运行单元测试
npm run lint     # 代码检查
```

技术栈：TypeScript + esbuild + 纯原生 DOM（无框架）+ vitest。

## 移除的功能（相对 AVM）

- 甘特图视图
- 看板视图
- 规划（Plan）功能
- 备忘录（Memo）独立功能（改为项目级 projectInfo 字段）
- TodoSidePanel 侧边弹窗（改为项目详情面板内嵌）
