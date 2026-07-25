# Project Todo System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed a per-project todo system into the APP Version Manager plugin, replacing the existing Memo feature.

**Architecture:** New `TodoService` handles CRUD for todo data stored as markdown frontmatter files. New `TodoSidePanel` component slides in from the right to show/manage todos for a selected project. A badge on each project card shows todo completion stats and opens the panel. Memo code is fully removed.

**Tech Stack:** TypeScript, Obsidian API, Node.js `fs`/`path` modules, existing `DataCache` + `parseFrontmatter`/`createFrontmatter` utilities.

**Files to create:**
- `src/services/TodoService.ts`
- `src/view/TodoSidePanel.ts`

**Files to modify:**
- `src/types.ts` — add `Todo` interface
- `src/main.ts` — wire `TodoService` into plugin
- `src/view/AppVersionManagerView.ts` — create `TodoSidePanel`, pass `onOpenTodos` + `todoStats` to sub-views
- `src/view/DualPaneView.ts` — add badge, remove memo dblclick, accept `onOpenTodos` + `todoStats`
- `src/view/KanbanView.ts` — add badge, accept `onOpenTodos` + `todoStats`
- `src/view/TableView.ts` — add badge column, remove memo dblclick, accept `onOpenTodos` + `todoStats`
- `src/services/DataService.ts` — remove memo methods, hook cascading delete
- `src/styles.ts` — add side panel + badge CSS
- `src/utils/linkUtils.ts` — remove `openProjectNote`, keep `openExternalLink`

---

### Task 1: Add Todo interface to types.ts

**Files:**
- Modify: `src/types.ts` (append after line 100, before `export interface SavedFilter`)

- [ ] **Step 1: Add Todo interface**

Add after the `Plan` interface (after line 100):

```typescript
export interface Todo {
  id: string;
  content: string;
  link: string;
  dueDate: string;
  completed: boolean;
  testStageRef?: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateTodoInput {
  content: string;
  link?: string;
  dueDate?: string;
  testStageRef?: string;
}
```

- [ ] **Step 2: Build to verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors from this change (may have pre-existing errors, just verify no "Todo" related errors).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add Todo and CreateTodoInput interfaces

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Create TodoService

**Files:**
- Create: `src/services/TodoService.ts`

- [ ] **Step 1: Write the service file**

```typescript
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { join, isAbsolute } from 'path';
import { normalizePath } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import { Todo, CreateTodoInput, ConcurrencyConflictError } from '../types';
import { DataCache } from '../utils/DataCache';
import { parseFrontmatter, createFrontmatter } from '../utils/frontmatter';
import { generateId } from '../utils/idUtils';

export class TodoService {
  private plugin: AppVersionManagerPlugin;
  private cache: DataCache;

  constructor(plugin: AppVersionManagerPlugin) {
    this.plugin = plugin;
    this.cache = new DataCache(5000);
  }

  private getDataPath(): string {
    return this.plugin.settings.dataPath || 'app-version-manager';
  }

  private isAbsolutePath(): boolean {
    const path = this.getDataPath();
    return isAbsolute(path) || /^[A-Za-z]:/.test(path);
  }

  private getProjectsFolder(): string {
    const dataPath = this.getDataPath();
    return this.isAbsolutePath()
      ? join(dataPath, 'projects')
      : `${dataPath}/projects`;
  }

  private getTodosFilePath(projectId: string): string {
    const folder = this.getProjectsFolder();
    return this.isAbsolutePath()
      ? join(folder, `todos__${projectId}.md`)
      : normalizePath(`${folder}/todos__${projectId}.md`);
  }

  async getByProjectId(projectId: string): Promise<Todo[]> {
    const cacheKey = `todos:${projectId}`;
    const cached = this.cache.get<Todo[]>(cacheKey);
    if (cached) return cached;

    const filePath = this.getTodosFilePath(projectId);

    if (this.isAbsolutePath()) {
      if (!existsSync(filePath)) return [];
      const content = readFileSync(filePath, 'utf-8');
      const parsed = parseFrontmatter(content);
      const todos = (parsed.todos || []) as Todo[];
      this.cache.set(cacheKey, todos);
      return todos;
    } else {
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (!file) return [];
      const content = await this.plugin.app.vault.read(file as any);
      const parsed = parseFrontmatter(content);
      const todos = (parsed.todos || []) as Todo[];
      this.cache.set(cacheKey, todos);
      return todos;
    }
  }

  async create(projectId: string, input: CreateTodoInput): Promise<Todo> {
    const todos = await this.getByProjectId(projectId);
    const now = new Date().toISOString();
    const todo: Todo = {
      id: generateId(),
      content: input.content,
      link: input.link || '',
      dueDate: input.dueDate || '',
      completed: false,
      testStageRef: input.testStageRef,
      projectId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    todos.push(todo);
    await this.saveTodos(projectId, todos);
    return todo;
  }

  async update(projectId: string, todo: Todo, expectedVersion?: number): Promise<Todo> {
    const todos = await this.getByProjectId(projectId);
    const index = todos.findIndex(t => t.id === todo.id);
    if (index === -1) throw new Error(`Todo not found: ${todo.id}`);

    const existing = todos[index];
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new ConcurrencyConflictError(`待办: ${todo.content}`, existing.version, expectedVersion);
    }

    todo.updatedAt = new Date().toISOString();
    todo.version = existing.version + 1;
    todos[index] = todo;
    await this.saveTodos(projectId, todos);
    return todo;
  }

  async delete(projectId: string, todoId: string): Promise<void> {
    const todos = await this.getByProjectId(projectId);
    const filtered = todos.filter(t => t.id !== todoId);
    if (filtered.length === todos.length) return;
    await this.saveTodos(projectId, filtered);
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    const filePath = this.getTodosFilePath(projectId);
    this.cache.invalidate(`todos:${projectId}`);

    if (this.isAbsolutePath()) {
      if (existsSync(filePath)) unlinkSync(filePath);
    } else {
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (file) await this.plugin.app.vault.delete(file as any);
    }
  }

  private async saveTodos(projectId: string, todos: Todo[]): Promise<void> {
    const filePath = this.getTodosFilePath(projectId);
    const frontmatter = createFrontmatter({ todos });
    this.cache.invalidate(`todos:${projectId}`);

    if (this.isAbsolutePath()) {
      writeFileSync(filePath, frontmatter, 'utf-8');
    } else {
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (file) {
        await this.plugin.app.vault.modify(file as any, frontmatter);
      } else {
        await this.plugin.app.vault.create(filePath, frontmatter);
      }
    }
  }
}
```

- [ ] **Step 2: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/TodoService.ts
git commit -m "feat: add TodoService for per-project todo CRUD

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Wire TodoService into plugin

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Import and add property**

Add import (after line 7, the BackupService import):
```typescript
import { TodoService } from './services/TodoService';
```

Add property (after `backupService: BackupService;` around line 13):
```typescript
todoService: TodoService;
```

- [ ] **Step 2: Instantiate in onload()**

In `onload()`, after `this.dataService = new DataService(this.app, this);` (around line 46):
```typescript
this.todoService = new TodoService(this);
```

- [ ] **Step 3: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire TodoService into plugin instance

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Add side panel and badge CSS to styles.ts

**Files:**
- Modify: `src/styles.ts` (append before the closing backtick)

- [ ] **Step 1: Add CSS rules**

Read the last 20 lines of `src/styles.ts` to find the insertion point, then append the following CSS rules before the final closing backtick:

```css
/* Todo side panel */
.avm-todo-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.3);
  z-index: 10;
  display: none;
}
.avm-todo-overlay.open { display: block; }

.avm-todo-panel {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 360px;
  background: var(--background-primary);
  border-left: 1px solid var(--background-modifier-border);
  z-index: 11;
  display: flex; flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.2s ease;
}
.avm-todo-panel.open { transform: translateX(0); }

.avm-todo-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
}
.avm-todo-panel-title { font-weight: 600; font-size: 15px; }
.avm-todo-panel-close {
  cursor: pointer; border: none; background: none;
  font-size: 18px; color: var(--text-muted); padding: 4px 8px;
}

.avm-todo-list {
  flex: 1; overflow-y: auto; padding: 8px 0;
}
.avm-todo-empty {
  text-align: center; color: var(--text-muted);
  padding: 40px 16px; font-size: 14px;
}

.avm-todo-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; border-bottom: 1px solid var(--background-modifier-border-hover);
}
.avm-todo-item.overdue { border-left: 3px solid #ef4444; }
.avm-todo-item.completed .avm-todo-content { text-decoration: line-through; color: var(--text-muted); }

.avm-todo-checkbox {
  flex-shrink: 0; width: 16px; height: 16px;
  cursor: pointer;
}
.avm-todo-content {
  flex: 1; font-size: 13px; cursor: pointer;
}
.avm-todo-due {
  font-size: 11px; color: var(--text-muted); white-space: nowrap; flex-shrink: 0;
  cursor: pointer;
}
.avm-todo-due.overdue { color: #ef4444; font-weight: 600; }
.avm-todo-link {
  flex-shrink: 0; cursor: pointer; color: var(--text-accent);
  font-size: 14px; opacity: 0.7;
}
.avm-todo-link:hover { opacity: 1; }
.avm-todo-delete {
  flex-shrink: 0; cursor: pointer; color: var(--text-muted);
  font-size: 12px; opacity: 0; padding: 2px 4px;
}
.avm-todo-item:hover .avm-todo-delete { opacity: 0.6; }
.avm-todo-delete:hover { opacity: 1 !important; color: #ef4444; }

.avm-todo-footer {
  display: flex; gap: 8px; padding: 12px 16px;
  border-top: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
}
.avm-todo-input {
  flex: 1; padding: 6px 10px; font-size: 13px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px; background: var(--background-primary);
}
.avm-todo-add-btn {
  padding: 6px 14px; font-size: 13px;
  background: var(--interactive-accent); color: white;
  border: none; border-radius: 4px; cursor: pointer;
}

/* Todo badge on project cards */
.avm-todo-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 10px;
  font-size: 11px; cursor: pointer;
  background: var(--background-modifier-hover);
  color: var(--text-muted);
}
.avm-todo-badge.has-overdue {
  background: #fef2f2; color: #ef4444;
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build 2>&1`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/styles.ts
git commit -m "feat: add todo side panel and badge CSS styles

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Create TodoSidePanel component

**Files:**
- Create: `src/view/TodoSidePanel.ts`

- [ ] **Step 1: Write the component**

```typescript
import AppVersionManagerPlugin from '../main';
import { Todo, CreateTodoInput } from '../types';
import { openExternalLink } from '../utils/linkUtils';
import { parseDateInput } from '../types';

export class TodoSidePanel {
  private plugin: AppVersionManagerPlugin;
  private containerEl: HTMLElement;
  private overlayEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private currentProjectId: string | null = null;
  private currentProjectName: string = '';

  constructor(containerEl: HTMLElement, plugin: AppVersionManagerPlugin) {
    this.containerEl = containerEl;
    this.plugin = plugin;
  }

  open(projectId: string, projectName: string): void {
    this.currentProjectId = projectId;
    this.currentProjectName = projectName;
    this.render();
    requestAnimationFrame(() => {
      this.overlayEl?.classList.add('open');
      this.panelEl?.classList.add('open');
    });
  }

  close(): void {
    this.overlayEl?.classList.remove('open');
    this.panelEl?.classList.remove('open');
    this.currentProjectId = null;
    this.currentProjectName = '';
  }

  destroy(): void {
    this.overlayEl?.remove();
    this.panelEl?.remove();
    this.overlayEl = null;
    this.panelEl = null;
  }

  private async render(): Promise<void> {
    this.destroy();

    // Overlay
    this.overlayEl = this.containerEl.createDiv({ cls: 'avm-todo-overlay' });
    this.overlayEl.addEventListener('click', () => this.close());

    // Panel
    this.panelEl = this.containerEl.createDiv({ cls: 'avm-todo-panel' });
    this.panelEl.addEventListener('click', (e) => e.stopPropagation());

    // Header
    const header = this.panelEl.createDiv({ cls: 'avm-todo-panel-header' });
    header.createDiv({ cls: 'avm-todo-panel-title', text: `📋 ${this.currentProjectName}` });
    const closeBtn = header.createEl('button', { cls: 'avm-todo-panel-close', text: '✕' });
    closeBtn.addEventListener('click', () => this.close());

    // List
    const listEl = this.panelEl.createDiv({ cls: 'avm-todo-list' });
    const todos = await this.plugin.todoService.getByProjectId(this.currentProjectId!);

    if (todos.length === 0) {
      listEl.createDiv({ cls: 'avm-todo-empty', text: '暂无待办' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

    // Sort: incomplete first, then by dueDate
    const sorted = [...todos].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    for (const todo of sorted) {
      const isOverdue = !todo.completed && todo.dueDate && todo.dueDate < todayStr;
      const item = listEl.createDiv({ cls: 'avm-todo-item' });
      if (isOverdue) item.addClass('overdue');
      if (todo.completed) item.addClass('completed');

      // Checkbox
      const checkbox = item.createEl('input', { type: 'checkbox', cls: 'avm-todo-checkbox' });
      checkbox.checked = todo.completed;
      checkbox.addEventListener('change', async () => {
        todo.completed = checkbox.checked;
        await this.plugin.todoService.update(this.currentProjectId!, todo, todo.version);
        this.render();
      });

      // Content
      const contentEl = item.createDiv({ cls: 'avm-todo-content', text: todo.content });
      contentEl.addEventListener('dblclick', () => {
        const input = item.createEl('input', { type: 'text', cls: 'avm-todo-input' });
        (input as any).value = todo.content;
        contentEl.replaceWith(input);
        input.focus();
        input.select();

        const saveContent = async () => {
          const newContent = (input as any).value.trim();
          input.replaceWith(contentEl);
          if (newContent && newContent !== todo.content) {
            todo.content = newContent;
            await this.plugin.todoService.update(this.currentProjectId!, todo, todo.version);
            contentEl.textContent = newContent;
          }
        };
        input.addEventListener('blur', saveContent);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') saveContent();
          if (e.key === 'Escape') {
            input.replaceWith(contentEl);
          }
        });
      });

      // Due date
      const dueEl = item.createDiv({ cls: 'avm-todo-due' });
      if (todo.dueDate) {
        dueEl.textContent = todo.dueDate;
        if (isOverdue) dueEl.addClass('overdue');
      } else {
        dueEl.textContent = '设置日期';
        dueEl.style.opacity = '0.4';
      }
      dueEl.addEventListener('click', () => {
        const input = item.createEl('input', { type: 'text', cls: 'avm-todo-input' });
        (input as any).value = todo.dueDate || '';
        input.style.width = '90px';
        input.placeholder = 'YYYY-MM-DD';
        dueEl.replaceWith(input);
        input.focus();

        const saveDate = async () => {
          const parsed = parseDateInput((input as any).value);
          input.replaceWith(dueEl);
          const newDate = parsed || '';
          if (newDate !== todo.dueDate) {
            todo.dueDate = newDate;
            await this.plugin.todoService.update(this.currentProjectId!, todo, todo.version);
          }
          this.render();
        };
        input.addEventListener('blur', saveDate);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') saveDate();
          if (e.key === 'Escape') { input.replaceWith(dueEl); }
        });
      });

      // Link button
      if (todo.link) {
        const linkBtn = item.createSpan({ cls: 'avm-todo-link', text: '🔗' });
        linkBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openExternalLink(todo.link);
        });
      }

      // Delete button
      const delBtn = item.createSpan({ cls: 'avm-todo-delete', text: '✕' });
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.plugin.todoService.delete(this.currentProjectId!, todo.id);
        this.render();
      });
    }

    // Footer: add input
    const footer = this.panelEl.createDiv({ cls: 'avm-todo-footer' });
    const input = footer.createEl('input', {
      type: 'text',
      cls: 'avm-todo-input',
      placeholder: '添加待办...'
    });
    const addBtn = footer.createEl('button', { cls: 'avm-todo-add-btn', text: '添加' });

    const addTodo = async () => {
      const content = (input as any).value.trim();
      if (!content) return;
      await this.plugin.todoService.create(this.currentProjectId!, { content });
      this.render();
    };
    addBtn.addEventListener('click', addTodo);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTodo();
    });
  }
}
```

- [ ] **Step 2: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/view/TodoSidePanel.ts
git commit -m "feat: add TodoSidePanel component with inline CRUD

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Wire side panel into AppVersionManagerView + pass callbacks to sub-views

**Files:**
- Modify: `src/view/AppVersionManagerView.ts`

- [ ] **Step 1: Add imports and property**

At the top, add import:
```typescript
import { TodoSidePanel } from './TodoSidePanel';
```

In the class body (after `importExportService` on line ~20), add:
```typescript
private todoSidePanel: TodoSidePanel;
private todoStats: Map<string, { total: number; completed: number; hasOverdue: boolean }> = new Map();
```

- [ ] **Step 2: Create TodoSidePanel in onOpen()**

In `onOpen()`, after `this.renderLoading();` (around line 59), add:
```typescript
this.todoSidePanel = new TodoSidePanel(this.containerEl, this.plugin);
```

- [ ] **Step 3: Add loadTodoStats helper**

Add a new method:
```typescript
private async loadTodoStats(projects: Project[]): Promise<void> {
  this.todoStats.clear();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}-${today.getDate().toString().padStart(2,'0')}`;

  for (const project of projects) {
    const todos = await this.plugin.todoService.getByProjectId(project.id);
    const completed = todos.filter(t => t.completed).length;
    const hasOverdue = todos.some(t => !t.completed && t.dueDate && t.dueDate < todayStr);
    this.todoStats.set(project.id, { total: todos.length, completed, hasOverdue });
  }
}
```

- [ ] **Step 4: Modify loadData to also load todo stats**

In `loadData()`, after the existing data loading code (after `this.plans = await this.plugin.dataService.getAllPlans();` around line 99), add:
```typescript
await this.loadTodoStats(this.projects);
```

- [ ] **Step 5: Modify refresh() to reload todo stats**

In `refresh()` (around line 128-131), change from:
```typescript
async refresh() {
    await this.loadData();
    this.render();
}
```
To:
```typescript
async refresh() {
    await this.loadData();
    this.render();
    // Re-load todo stats after render to keep badge counts fresh
    await this.loadTodoStats(this.projects);
    this.render();
}
```

Wait, that double-renders. Instead, modify `loadData` to include todo stats (already done in step 4). The `refresh` method just needs to stay as-is since `loadData` already calls `loadTodoStats`:

```typescript
async refresh() {
    await this.loadData();
    this.render();
}
```

No change needed — `loadData()` already calls `loadTodoStats` from step 4.

- [ ] **Step 6: Add onOpenTodos callback to DualPaneView construction**

In `renderMainView()`, add the `onOpenTodos` callback as a new parameter. Change the DualPaneView construction (around line 347-361) to add:

```typescript
(projectId: string, projectName: string) => {
  this.todoSidePanel.open(projectId, projectName);
}
```

Full block:
```typescript
case 'dual':
  new DualPaneView(
    this.mainEl,
    this.plugin,
    this.apps,
    filteredVersions,
    appFilteredProjects,
    this.selectedVersionId,
    (versionId) => {
      this.selectedVersionId = versionId;
      this.render();
    },
    () => this.showCreateVersionModal(),
    () => this.showCreateProjectModal(),
    () => this.refresh(),
    (projectId: string, projectName: string) => {
      this.todoSidePanel.open(projectId, projectName);
    },
    this.todoStats
  );
  break;
```

- [ ] **Step 7: Add onOpenTodos + todoStats to KanbanView construction**

Change the KanbanView construction (around line 364-371):
```typescript
case 'kanban':
  new KanbanView(
    this.mainEl,
    this.plugin,
    appFilteredProjects,
    filteredVersions,
    this.apps,
    () => this.refresh(),
    (projectId: string, projectName: string) => {
      this.todoSidePanel.open(projectId, projectName);
    },
    this.todoStats
  );
  break;
```

- [ ] **Step 8: Add onOpenTodos + todoStats to TableView construction**

Change the TableView construction (around line 373-381):
```typescript
case 'table':
  new TableView(
    this.mainEl,
    this.plugin,
    appFilteredProjects,
    filteredVersions,
    this.apps,
    () => this.refresh(),
    (projectId: string, projectName: string) => {
      this.todoSidePanel.open(projectId, projectName);
    },
    this.todoStats
  );
  break;
```

- [ ] **Step 9: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Type errors from the sub-view constructors (they don't accept the new params yet). We'll fix those in the next tasks. Any other errors should be addressed.

- [ ] **Step 10: Commit**

```bash
git add src/view/AppVersionManagerView.ts
git commit -m "feat: wire TodoSidePanel into AppVersionManagerView, pass onOpenTodos to sub-views

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Add badge to DualPaneView, accept new params, remove memo

**Files:**
- Modify: `src/view/DualPaneView.ts`

- [ ] **Step 1: Update constructor to accept new params**

Add two new properties to the class (after existing properties around line 21):
```typescript
onOpenTodos: (projectId: string, projectName: string) => void;
todoStats: Map<string, { total: number; completed: number; hasOverdue: boolean }>;
```

Update the constructor signature to add the two new params at the end:
```typescript
constructor(
    containerEl: HTMLElement,
    plugin: AppVersionManagerPlugin,
    apps: App[],
    versions: Version[],
    projects: Project[],
    selectedVersionId: string | null,
    onVersionSelect: (versionId: string | null) => void,
    onCreateVersion: () => void,
    onCreateProject: () => void,
    onRefresh: () => void,
    onOpenTodos: (projectId: string, projectName: string) => void = () => {},
    todoStats: Map<string, { total: number; completed: number; hasOverdue: boolean }> = new Map()
) {
    // ... existing assignments ...
    this.onOpenTodos = onOpenTodos;
    this.todoStats = todoStats;
    this.render();
}
```

- [ ] **Step 2: Add badge rendering in renderProjectItem**

In `renderProjectItem()` (around line 280, before the context menu event listener), add:

```typescript
// Todo badge
const stats = this.todoStats.get(project.id);
const badge = item.createDiv({
  cls: 'avm-todo-badge' + (stats && stats.hasOverdue ? ' has-overdue' : ''),
  text: stats ? `📋 ${stats.completed}/${stats.total}` : '📋 -'
});
badge.addEventListener('click', (e) => {
  e.stopPropagation();
  this.onOpenTodos(project.id, project.name);
});
```

- [ ] **Step 3: Remove memo double-click handler**

Remove the double-click event listener that opens memos (lines 322-326):
```typescript
// REMOVE this block:
item.addEventListener('dblclick', async (e) => {
    e.preventDefault();
    const memoPath = await this.plugin.dataService.ensureMemoFile(project.name);
    await openProjectNote(this.plugin.app, memoPath, this.plugin.dataService.isAbsolutePath());
});
```

- [ ] **Step 4: Remove unused import**

Remove `openProjectNote` from the import from `../utils/linkUtils` (line 9):
```typescript
// Change from:
import { openExternalLink, openProjectNote } from '../utils/linkUtils';
// To:
import { openExternalLink } from '../utils/linkUtils';
```

Also remove `TFile` from the obsidian import if it's no longer used (check if `TFile` is used elsewhere in the file — search for it. It's likely not needed after removing memo code).

Change line 1 from:
```typescript
import { Menu, Modal, App as ObsidianApp, Setting, ButtonComponent, TFile, Notice } from 'obsidian';
```
To:
```typescript
import { Menu, Modal, App as ObsidianApp, Setting, ButtonComponent, Notice } from 'obsidian';
```

- [ ] **Step 5: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Type errors may remain from KanbanView/TableView not yet accepting new params. DualPaneView-specific errors should be gone.

- [ ] **Step 6: Commit**

```bash
git add src/view/DualPaneView.ts
git commit -m "feat: add todo badge to DualPaneView cards, remove memo dblclick

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Add badge to KanbanView, accept new params

**Files:**
- Modify: `src/view/KanbanView.ts`

- [ ] **Step 1: Update constructor to accept new params**

Add two new properties to the class (after `onRefresh` around line 15):
```typescript
onOpenTodos: (projectId: string, projectName: string) => void;
todoStats: Map<string, { total: number; completed: number; hasOverdue: boolean }>;
```

Update the constructor signature to add the two new params:
```typescript
constructor(
    containerEl: HTMLElement,
    plugin: AppVersionManagerPlugin,
    projects: Project[],
    versions: Version[],
    apps: App[],
    onRefresh: () => void = () => {},
    onOpenTodos: (projectId: string, projectName: string) => void = () => {},
    todoStats: Map<string, { total: number; completed: number; hasOverdue: boolean }> = new Map()
) {
    // ... existing assignments ...
    this.onOpenTodos = onOpenTodos;
    this.todoStats = todoStats;
    this.render();
}
```

- [ ] **Step 2: Add badge rendering in renderCard**

In `renderCard()`, after the features/spec rendering (around line 142, before the context menu event listener), add:

```typescript
// Todo badge
const stats = this.todoStats.get(project.id);
const badge = card.createDiv({
  cls: 'avm-todo-badge' + (stats && stats.hasOverdue ? ' has-overdue' : ''),
  text: stats ? `📋 ${stats.completed}/${stats.total}` : '📋 -'
});
badge.addEventListener('click', (e) => {
  e.stopPropagation();
  this.onOpenTodos(project.id, project.name);
});
```

- [ ] **Step 3: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Only TableView type errors remain (fixed next).

- [ ] **Step 4: Commit**

```bash
git add src/view/KanbanView.ts
git commit -m "feat: add todo badge to KanbanView cards

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: Add badge to TableView, accept new params, remove memo

**Files:**
- Modify: `src/view/TableView.ts`

- [ ] **Step 1: Update constructor to accept new params**

Add two new properties to the class (after `onRefresh` + `sortState` around line 30):
```typescript
onOpenTodos: (projectId: string, projectName: string) => void;
todoStats: Map<string, { total: number; completed: number; hasOverdue: boolean }>;
```

Update the constructor signature:
```typescript
constructor(
    containerEl: HTMLElement,
    plugin: AppVersionManagerPlugin,
    projects: Project[],
    versions: Version[],
    apps: App[],
    onRefresh: () => void = () => {},
    onOpenTodos: (projectId: string, projectName: string) => void = () => {},
    todoStats: Map<string, { total: number; completed: number; hasOverdue: boolean }> = new Map()
) {
    // ... existing assignments ...
    this.onOpenTodos = onOpenTodos;
    this.todoStats = todoStats;
    this.render();
}
```

- [ ] **Step 2: Add todos column to the columns array**

In `render()`, at line 141-151 where `columns` is defined, add a new column entry after the `progress` column (after line 147):

```typescript
{ key: 'todos', label: '待办', width: '80px', sortable: false },
```

So lines 141-151 become:
```typescript
const columns: TableColumn[] = [
  { key: 'name', label: '项目名称', width: '150px' },
  { key: 'versionNumber', label: '版本号', width: '100px', sortable: true },
  { key: 'manager', label: '项目经理', width: '100px', sortable: true },
  { key: 'features', label: '特性', width: '150px', sortable: true },
  { key: 'spec', label: '配置组件/规格', width: '150px' },
  { key: 'progress', label: '进度', width: '120px', sortable: true },
  { key: 'todos', label: '待办', width: '80px', sortable: false },
  { key: 'nextStage', label: '下一阶段', width: '120px' },
  { key: 'nextStageTime', label: '下一阶段时间', width: '120px', sortable: true },
  { key: 'links', label: '链接', width: '120px' }
];
```

- [ ] **Step 3: Add todo badge rendering in the switch statement**

In `renderRow()`, inside the `columns.forEach(col => { ... })` switch statement, add a new case after `case 'progress':` (after line 240):

```typescript
case 'todos':
  const stats = this.todoStats.get(project.id);
  const todoBadge = td.createDiv({
    cls: 'avm-todo-badge' + (stats && stats.hasOverdue ? ' has-overdue' : ''),
    text: stats ? `📋 ${stats.completed}/${stats.total}` : '📋 -'
  });
  todoBadge.addEventListener('click', (e) => {
    e.stopPropagation();
    this.onOpenTodos(project.id, project.name);
  });
  break;
```

- [ ] **Step 4: Remove memo double-click handler**

Remove lines 283-287 (the row dblclick event listener):
```typescript
// REMOVE this entire block:
row.addEventListener('dblclick', async (e) => {
    e.preventDefault();
    const memoPath = await this.plugin.dataService.ensureMemoFile(project.name);
    await openProjectNote(this.plugin.app, memoPath, this.plugin.dataService.isAbsolutePath());
});
```

- [ ] **Step 5: Remove unused import of openProjectNote**

Line 9, change from:
```typescript
import { openExternalLink, openProjectNote } from '../utils/linkUtils';
```
To:
```typescript
import { openExternalLink } from '../utils/linkUtils';
```

- [ ] **Step 6: Remove unused obsidian imports**

Line 1, change from:
```typescript
import { Menu, Modal, App as ObsidianApp, Setting, TFile, normalizePath, Notice } from 'obsidian';
```
To:
```typescript
import { Menu, Modal, App as ObsidianApp, Setting, Notice } from 'obsidian';
```

- [ ] **Step 5: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No type errors. All constructors now match.

- [ ] **Step 6: Commit**

```bash
git add src/view/TableView.ts
git commit -m "feat: add todo badge to TableView rows, remove memo dblclick

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: Remove Memo code from DataService

**Files:**
- Modify: `src/services/DataService.ts`

- [ ] **Step 1: Remove getMemosFolder method (lines 55-57)**

```typescript
// REMOVE these 3 lines:
private getMemosFolder(): string {
    return this.isAbsolutePath() ? join(this.getDataPath(), 'memos') : `${this.getDataPath()}/memos`;
}
```

- [ ] **Step 2: Remove memo folder creation from initializeDataFolders (line 115)**

```typescript
// REMOVE this line:
await this.ensureFolder(this.getMemosFolder());
```

- [ ] **Step 3: Remove memo file creation from createProject (lines 784-789)**

```typescript
// REMOVE these 5 lines:
const memoFilePath = this.isAbsolutePath()
    ? join(this.getMemosFolder(), `${fileName}.md`)
    : normalizePath(`${this.getMemosFolder()}/${fileName}.md`);

await this.writeFile(memoFilePath, '');
```

- [ ] **Step 4: Remove memo renaming from updateProject**

In `updateProject()`, remove the absolute-path memo rename block (lines 882-886):
```typescript
// REMOVE:
const oldMemoPath = join(this.getMemosFolder(), `${oldFileName}.md`);
const newMemoPath = join(this.getMemosFolder(), `${newFileName}.md`);
if (existsSync(oldMemoPath)) {
    renameSync(oldMemoPath, newMemoPath);
}
```

And remove the vault-relative memo rename block (lines 889-893):
```typescript
// REMOVE:
const oldMemoPath = normalizePath(`${this.getMemosFolder()}/${oldFileName}.md`);
const newMemoPath = normalizePath(`${this.getMemosFolder()}/${newFileName}.md`);
const memoFile = this.app.vault.getAbstractFileByPath(oldMemoPath);
if (memoFile instanceof TFile) {
    await this.app.vault.rename(memoFile, newMemoPath);
}
```

- [ ] **Step 5: Remove memo deletion from deleteProject**

Remove `let memoFile: TFile | CustomFile | null = null;` (line 913).

Remove the absolute-path memo lookup block (lines 926-936):
```typescript
// REMOVE:
const memoPath = this.getProjectMemoPath(project.name);
if (existsSync(memoPath)) {
    memoFile = {
      path: memoPath,
      basename: basename(memoPath, '.md'),
      ... // the entire CustomFile object
    };
}
```

Remove the vault-relative memo lookup block (lines 945-947):
```typescript
// REMOVE:
const memoPath = this.getProjectMemoPath(project.name);
const memoFallbackFile = this.app.vault.getAbstractFileByPath(memoPath);
memoFile = memoFallbackFile instanceof TFile ? memoFallbackFile : null;
```

Remove the memo file deletion (lines 954-955):
```typescript
// REMOVE:
if (memoFile) {
    await this.deleteFile(memoFile);
}
```

- [ ] **Step 6: Remove getProjectMemoPath and ensureMemoFile methods**

Remove `getProjectMemoPath` (lines 1006-1009):
```typescript
// REMOVE:
getProjectMemoPath(projectName: string, projectId?: string): string {
    const targetPath = `${this.getMemosFolder()}/${fileName}.md`;
    ...
}
```

Remove `ensureMemoFile` (lines 1012-1031):
```typescript
// REMOVE the entire async ensureMemoFile(projectName: string): Promise<string> method
```

- [ ] **Step 7: Remove memo file creation from import/restore code (lines 1091-1098)**

```typescript
// REMOVE:
const memoPath = this.getProjectMemoPath(record.name);
if (this.isAbsolutePath()) {
    if (!existsSync(memoPath)) {
        writeFileSync(memoPath, '', 'utf-8');
    }
} else {
    if (!this.app.vault.getAbstractFileByPath(memoPath)) {
        await this.app.vault.create(memoPath, '');
    }
}
```

- [ ] **Step 8: Hook cascading delete in deleteProject**

In `deleteProject()`, before `this.cache.invalidate('projects:all')`, add:
```typescript
await this.plugin.todoService.deleteByProjectId(project.id);
```

- [ ] **Step 9: Remove unused imports**

After removing memo code, check if `renameSync` is still used elsewhere. If not, remove it from the `fs` import on line 2. Also check if `TFile` is still used — if only in removed memo code, remove from obsidian import on line 1.

- [ ] **Step 9: Build to verify**

Run: `npm run build 2>&1`
Expected: Build succeeds with no errors.

- [ ] **Step 10: Commit**

```bash
git add src/services/DataService.ts
git commit -m "refactor: remove Memo code, add cascading todo delete on project removal

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: Remove openProjectNote from linkUtils

**Files:**
- Modify: `src/utils/linkUtils.ts`

- [ ] **Step 1: Remove the function and its imports**

Remove the `openProjectNote` function (lines 17-44) entirely. Also remove unused imports that were only used by `openProjectNote`:
- Remove `TFile` and `normalizePath` from the obsidian import if they're only used by `openProjectNote`
- Remove the `ObsidianApp` type import if only used by `openProjectNote`

The file should end up containing only `openExternalLink`.

- [ ] **Step 2: Build to verify**

Run: `npm run build 2>&1`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/utils/linkUtils.ts
git commit -m "refactor: remove openProjectNote from linkUtils (replaced by todo system)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 12: End-to-end build verification

- [ ] **Step 1: Full production build**

Run: `npm run build 2>&1`
Expected: `main.js` generated successfully, no errors.

- [ ] **Step 2: Verify all imports resolve**

Run: `npx tsc --noEmit 2>&1`
Expected: No type errors.

- [ ] **Step 3: Review diff for completeness**

Run: `git diff main --stat`
Expected: Shows all modified files.

- [ ] **Step 4: Verify checklist**

Check each spec requirement is met:
- [x] Todo data model with all fields
- [x] TodoService with CRUD + caching
- [x] Side panel with slide-in animation
- [x] Card badge with completion stats
- [x] Overdue highlighting (badge red + panel red)
- [x] Memo code removal (DataService, DualPaneView, TableView, linkUtils)
- [x] Cascading delete on project removal
- [x] External link opening for todo links

- [ ] **Step 5: Final commit (if any fixes)**

```bash
git add -A
git commit -m "chore: final verification fixes for todo system

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
