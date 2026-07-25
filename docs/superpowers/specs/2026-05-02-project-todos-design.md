# Project Todo System — Design Spec

## Overview

Embed a per-project todo system into the APP Version Manager plugin. Todos replace the existing Memo feature and live as structured task lists tied to projects, with optional linkage to project test-stage deadlines.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Storage | Independent files: `todos__{projectId}.md` per project |
| UI | Side panel (slides in from right) + card badge |
| Memo | **Removed** — todos replace it; no migration |
| Deadline model | Free due date + optional `testStageRef` to borrow a project test-stage date as default |
| Overdue display | Card badge counter + red highlight inside panel |

## Data Model

```typescript
export interface Todo {
  id: string;
  content: string;
  link: string;              // URL, empty string if none
  dueDate: string;           // YYYY-MM-DD
  completed: boolean;
  testStageRef?: string;     // optional key like "b1IntegrationTestTime"
  projectId: string;
  createdAt: string;
  updatedAt: string;
  version: number;           // optimistic concurrency
}
```

### File format

Path: `{dataPath}/projects/todos__{projectId}.md` (same folder as project files)

```markdown
---
todos:
  - id: "uuid-1"
    content: "和 PM 对齐需求细节"
    link: "https://doc.example.com/req"
    dueDate: "2026-05-10"
    completed: false
    testStageRef: "b1IntegrationTestTime"
    version: 1
    createdAt: "2026-05-02T10:00:00.000Z"
    updatedAt: "2026-05-02T10:00:00.000Z"
---
```

File naming follows the existing convention of `{name}__{id}.md`, using `todos` as the name part.

## TodoService

New file: `src/services/TodoService.ts`

- Follows DataService patterns: `isAbsolutePath()` branching, `parseFrontmatter()` for YAML, `DataCache` with 5s TTL
- CRUD methods:
  - `getByProjectId(projectId: string): Todo[]`
  - `create(projectId: string, input: CreateTodoInput): Todo`
  - `update(projectId: string, todo: Todo, expectedVersion: number): Todo`
  - `delete(projectId: string, todoId: string): void`
- `update` throws `ConcurrencyConflictError` on version mismatch
- Exposes `deleteByProjectId(projectId)` for cascading delete when a project is removed

## View Layer

### TodoSidePanel (`src/view/TodoSidePanel.ts`)

- Managed by `AppVersionManagerView`, shared across all sub-views
- Slides in from the right as an HTML overlay div (not an Obsidian workspace leaf)
- Lifecycle: `open(projectId)` / `close()` / `destroy()`
- Layout:
  - Header: project name + close button
  - Body: scrollable todo list (checkbox, content text, link icon button, due date)
  - Footer: text input + add button for quick creation
- Overdue items rendered with red background/dot
- Clicking the link icon opens the URL via `window.open` in external browser
- Inline edit: click content text to edit; click date to pick new date

### Card badge

- Added to project card rendering in all views (DualPane, Kanban, Table)
- Format: `📋 3/5` (completed/total)
- Turns red when any todo is overdue (dueDate < today && !completed)
- Clicking the badge opens `TodoSidePanel` for that project

## Memo Removal

- Remove Memo-related types, DataService methods (`getMemosFolder`, `getProjectMemoPath`, `ensureMemoFile`), and UI rendering (`openProjectNote` calls in DualPaneView and TableView)
- Existing memo markdown files under `{dataPath}/memos/` are left untouched — no automatic deletion

## Cascading Delete

When a project is deleted, `DataService.deleteProject` calls `TodoService.deleteByProjectId(projectId)` to remove the associated todos file.

## Edge Cases

- **Empty todos**: side panel shows "暂无待办" empty state
- **Deleted project with no todos file**: `getByProjectId` returns `[]` if file doesn't exist
- **Concurrent edits**: version mismatch on update throws `ConcurrencyConflictError`; caller re-fetches and retries
- **testStageRef points to deleted stage**: treated as null — the due date stands, no stage reference displayed

## Not In Scope

- Daily inheritance / rollover of incomplete todos (unlike the todolist plugin)
- Priority levels, tags
- Multi-user collaboration beyond the existing concurrency check
