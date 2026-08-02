import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';
import { normalizePath, TFile } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import { Todo, CreateTodoInput, TodoStatus, ConcurrencyConflictError, PluginSettings } from '../types';
import { parseFrontmatter, createFrontmatter, parseNumericField } from '../utils/frontmatter';
import { generateId, sanitizeFileName } from '../utils/idUtils';
import { nowISO, todayStr } from '../utils/dateUtils';

/** null 键的占位符（Map 不方便直接用 null 作 key） */
const NULL_KEY = '__null__';

/**
 * 全局待办服务（重构自 AVM TodoService）。
 *
 * 关键变化：
 *  - 每个 Todo 独立一个 .md 文件（AVM 原本是 todos__{projectId}.md 集中数组）
 *  - 支持全局待办（projectId=null）和项目待办（projectId 非空）
 *  - 多维内存索引（byId/byCategory/byProject/byStatus/byDueDate）
 *  - create/update/delete 不再需要 projectId 作为第一参数（projectId 是 Todo 字段之一）
 *  - status 三态状态机替代 completed: boolean
 */
export class TodoService {
  private plugin: AppVersionManagerPlugin;

  // 多维内存索引（启动时构建，CRUD 时增量维护）
  private byId = new Map<string, Todo>();
  private byCategory = new Map<string, Set<Todo>>();
  private byProject = new Map<string, Set<Todo>>();
  private byStatus = new Map<TodoStatus, Set<Todo>>();
  private byDueDate = new Map<string, Set<Todo>>();
  private byPerson = new Map<string, Set<Todo>>();
  private loaded = false;
  private currentResponsiblePerson: string = '';

  constructor(plugin: AppVersionManagerPlugin) {
    this.plugin = plugin;
  }

  // ---------- 负责人筛选 ----------
  /** 获取当前选中的负责人（空字符串=显示全部） */
  getCurrentResponsiblePerson(): string {
    return this.currentResponsiblePerson;
  }

  /** 设置当前负责人，切换后视图应重新渲染 */
  setCurrentResponsiblePerson(person: string): void {
    this.currentResponsiblePerson = person;
  }

  /** 获取所有有待办的负责人列表（去重+排序） */
  getResponsiblePersons(): string[] {
    const persons = new Set<string>();
    for (const todo of this.byId.values()) {
      if (todo.responsiblePerson) persons.add(todo.responsiblePerson);
    }
    return [...persons].sort();
  }

  private getDataPath(): string {
    return this.plugin.settings.dataPath || 'workflow-hub';
  }

  private getTodosFolder(): string {
    const dataPath = this.getDataPath();
    return this.plugin.dataService.pathResolver.isAbsolutePath()
      ? this.plugin.dataService.pathResolver.joinPath(dataPath, 'todos')
      : `${dataPath}/todos`;
  }

  /** 文件路径：按负责人分文件夹，无负责人放根目录 */
  private getTodoFilePath(todo: Pick<Todo, 'id' | 'content'> | Todo): string {
    const folder = this.getTodosFolder();
    const name = sanitizeFileName((todo.content || 'untitled').slice(0, 20));
    const fileName = `${name}__${todo.id}.md`;
    // 按负责人分文件夹
    const person = 'responsiblePerson' in todo ? todo.responsiblePerson : '';
    if (person && person.trim()) {
      const personFolder = sanitizeFileName(person.trim());
      return this.plugin.dataService.pathResolver.isAbsolutePath()
        ? this.plugin.dataService.pathResolver.joinPath(folder, personFolder, fileName)
        : normalizePath(`${folder}/${personFolder}/${fileName}`);
    }
    return this.plugin.dataService.pathResolver.isAbsolutePath()
      ? this.plugin.dataService.pathResolver.joinPath(folder, fileName)
      : normalizePath(`${folder}/${fileName}`);
  }

  // ---------- 索引加载 ----------
  /** 启动时加载全部待办并构建索引（layoutReady 后调用一次） */
  async loadAllIndexes(): Promise<void> {
    if (this.loaded) return;
    this.clearIndexes();
    const todos = await this.readAllTodosFromDisk();
    for (const todo of todos) this.indexAdd(todo);
    this.loaded = true;
  }

  /** 强制重建索引（数据迁移后调用） */
  async invalidateAll(): Promise<void> {
    this.loaded = false;
    this.clearIndexes();
    await this.loadAllIndexes();
  }

  /** 切换数据路径时重置索引状态 */
  resetPath(): void {
    this.loaded = false;
    this.clearIndexes();
  }

  // ---------- vault 事件监听（外部修改时自动重建索引） ----------
  /** 自身写操作深度计数（>0 时 vault 事件来自插件自己，跳过重建） */
  private selfWriteDepth = 0;
  /** 已注册的 vault 事件引用（注销用） */
  private vaultHandlerRefs: { event: string; ref: unknown }[] = [];
  /** 外部变更重建索引的防抖定时器 */
  private rebuildTimer: number | null = null;
  /** 防抖间隔：合并批量变更（迁移/恢复/同步）为一次重建 */
  private static readonly REBUILD_DEBOUNCE_MS = 300;

  /** 注册 vault 事件监听，外部修改时自动失效索引 */
  registerVaultEvents(): void {
    // 绝对路径模式下不走 vault API，无法监听
    if (this.plugin.dataService.pathResolver.isAbsolutePath()) return;
    if (this.vaultHandlerRefs.length > 0) return; // 防止重复注册（热重载）

    const handler = (file: unknown) => {
      if (this.selfWriteDepth > 0) return; // 插件自身写入不触发重建
      const path = (file as { path?: unknown } | null)?.path;
      if (typeof path !== 'string') return;
      // 动态获取当前目录前缀，切换 dataPath 后依然有效
      if (path.startsWith(this.getTodosFolder() + '/')) {
        this.scheduleRebuild();
      }
    };
    const vault = this.plugin.app.vault as {
      on: (event: string, cb: (file: unknown) => void) => unknown;
      offref: (ref: unknown) => void;
    };
    for (const event of ['create', 'modify', 'delete']) {
      this.vaultHandlerRefs.push({ event, ref: vault.on(event, handler) });
    }
  }

  /** 注销 vault 事件监听（插件卸载时调用） */
  unregisterVaultEvents(): void {
    const vault = this.plugin.app.vault as {
      offref: (ref: unknown) => void;
    };
    for (const { ref } of this.vaultHandlerRefs) {
      vault.offref(ref);
    }
    this.vaultHandlerRefs = [];
    if (this.rebuildTimer !== null) {
      window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
  }

  /** 防抖合并多次外部变更，只重建一次索引 */
  private scheduleRebuild(): void {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      this.invalidateAll().catch((e) => console.error('[WorkflowHub] 待办索引重建失败:', e));
    }, TodoService.REBUILD_DEBOUNCE_MS);
  }

  private clearIndexes(): void {
    this.byId.clear();
    this.byCategory.clear();
    this.byProject.clear();
    this.byStatus.clear();
    this.byDueDate.clear();
    this.byPerson.clear();
  }

  // ---------- 索引维护 ----------
  private indexAdd(todo: Todo): void {
    this.byId.set(todo.id, todo);
    this.addToSetIndex(this.byCategory, todo.categoryId ?? NULL_KEY, todo);
    this.addToSetIndex(this.byProject, todo.projectId ?? NULL_KEY, todo);
    this.addToSetIndex(this.byStatus, todo.status, todo);
    if (todo.dueDate) this.addToSetIndex(this.byDueDate, todo.dueDate, todo);
    this.addToSetIndex(this.byPerson, todo.responsiblePerson || NULL_KEY, todo);
  }

  private indexRemove(todo: Todo): void {
    this.byId.delete(todo.id);
    this.removeFromSetIndex(this.byCategory, todo.categoryId ?? NULL_KEY, todo);
    this.removeFromSetIndex(this.byProject, todo.projectId ?? NULL_KEY, todo);
    this.removeFromSetIndex(this.byStatus, todo.status, todo);
    if (todo.dueDate) this.removeFromSetIndex(this.byDueDate, todo.dueDate, todo);
    this.removeFromSetIndex(this.byPerson, todo.responsiblePerson || NULL_KEY, todo);
  }

  private addToSetIndex<K>(map: Map<K, Set<Todo>>, key: K, todo: Todo): void {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(todo);
  }

  private removeFromSetIndex<K>(map: Map<K, Set<Todo>>, key: K, todo: Todo): void {
    const set = map.get(key);
    if (set) {
      set.delete(todo);
      if (set.size === 0) map.delete(key);
    }
  }

  // ---------- 磁盘读写 ----------
  private async readAllTodosFromDisk(): Promise<Todo[]> {
    const folder = this.getTodosFolder();
    const todos: Todo[] = [];
    const seenIds = new Set<string>();

    if (this.plugin.dataService.pathResolver.isAbsolutePath()) {
      if (!existsSync(folder)) return [];
      this.readTodosFromDirRecursive(folder, todos, seenIds);
    } else {
      const prefix = `${folder}/`;
      for (const file of this.plugin.app.vault.getMarkdownFiles()) {
        if (file.path.startsWith(prefix)) {
          try {
            const content = await this.plugin.app.vault.adapter.read(file.path);
            const todo = this.parseTodoContent(content);
            if (todo && !seenIds.has(todo.id)) {
              seenIds.add(todo.id);
              todos.push(todo);
            }
          } catch (e) {
            console.error('[WorkflowHub] Failed to parse todo file:', file.path, e);
          }
        }
      }
    }
    return todos;
  }

  /** 递归扫描目录及其子文件夹中的待办文件（绝对路径模式） */
  private readTodosFromDirRecursive(dir: string, todos: Todo[], seenIds: Set<string>): void {
    for (const item of readdirSync(dir)) {
      const full = join(dir, item);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          this.readTodosFromDirRecursive(full, todos, seenIds);
        } else if (stat.isFile() && item.endsWith('.md')) {
          const content = readFileSync(full, 'utf-8');
          const todo = this.parseTodoContent(content);
          if (todo && !seenIds.has(todo.id)) {
            seenIds.add(todo.id);
            todos.push(todo);
          }
        }
      } catch (e) {
        console.error('[WorkflowHub] Failed to parse todo file:', full, e);
      }
    }
  }

  private parseTodoContent(content: string): Todo | null {
    const fm = parseFrontmatter(content);
    if (!fm || !fm.id) return null;
    const isNullish = (v: unknown) => v === null || v === undefined || v === '';
    return {
      id: String(fm.id),
      content: fm.content ?? '',
      link: fm.link ?? '',
      dueDate: fm.dueDate ?? '',
      priority: (fm.priority ?? '') as Todo['priority'],
      status: (fm.status ?? 'todo') as TodoStatus,
      pinned: fm.pinned === true,
      categoryId: isNullish(fm.categoryId) ? null : String(fm.categoryId),
      projectId: isNullish(fm.projectId) ? null : String(fm.projectId),
      responsiblePerson: fm.responsiblePerson ?? '',
      completedAt: fm.completedAt ?? '',
      createdAt: fm.createdAt ?? '',
      updatedAt: fm.updatedAt ?? '',
      version: parseNumericField(fm.version, 1),
    };
  }

  private serializeTodo(todo: Todo): string {
    return createFrontmatter({
      id: todo.id,
      content: todo.content,
      link: todo.link,
      dueDate: todo.dueDate,
      priority: todo.priority,
      status: todo.status,
      pinned: todo.pinned,
      categoryId: todo.categoryId,
      projectId: todo.projectId,
      responsiblePerson: todo.responsiblePerson,
      completedAt: todo.completedAt,
      createdAt: todo.createdAt,
      updatedAt: todo.updatedAt,
      version: todo.version,
    });
  }

  private async writeTodoFile(todo: Todo): Promise<void> {
    // 自身写操作标记：vault 事件触发时跳过索引重建（避免每次保存全量重读）
    this.selfWriteDepth++;
    try {
      const filePath = this.getTodoFilePath(todo);
      const content = this.serializeTodo(todo);
      await this.ensureFileFolder(filePath);
      if (this.plugin.dataService.pathResolver.isAbsolutePath()) {
        writeFileSync(filePath, content, 'utf-8');
      } else {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          await this.plugin.app.vault.modify(file, content);
        } else {
          await this.plugin.app.vault.create(filePath, content);
        }
      }
    } finally {
      this.selfWriteDepth--;
    }
  }

  /** 确保文件所在目录存在（包括负责人子文件夹） */
  private async ensureFileFolder(filePath: string): Promise<void> {
    const dir = filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
    if (this.plugin.dataService.pathResolver.isAbsolutePath()) {
      const { mkdirSync, existsSync } = await import('fs');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    } else {
      if (!this.plugin.app.vault.getAbstractFileByPath(dir)) {
        await this.plugin.app.vault.createFolder(dir).catch(() => {});
      }
    }
  }

  private async deleteTodoFile(todo: Pick<Todo, 'id' | 'content' | 'responsiblePerson'>): Promise<void> {
    this.selfWriteDepth++;
    try {
      const filePath = this.getTodoFilePath(todo);
      if (this.plugin.dataService.pathResolver.isAbsolutePath()) {
        if (existsSync(filePath)) unlinkSync(filePath);
      } else {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) await this.plugin.app.vault.delete(file);
      }
    } finally {
      this.selfWriteDepth--;
    }
  }

  private async ensureFolder(): Promise<void> {
    const folder = this.getTodosFolder();
    if (this.plugin.dataService.pathResolver.isAbsolutePath()) {
      if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
    } else {
      if (!this.plugin.app.vault.getAbstractFileByPath(folder)) {
        await this.plugin.app.vault.createFolder(folder).catch(() => {});
      }
    }
  }

  // ---------- 查询 API ----------
  async getAllTodos(): Promise<Todo[]> {
    if (!this.loaded) await this.loadAllIndexes();
    let todos = [...this.byId.values()];
    if (this.currentResponsiblePerson) {
      todos = todos.filter((t) => t.responsiblePerson === this.currentResponsiblePerson);
    }
    return todos;
  }

  /** 获取全部待办（绕过全局负责人筛选） */
  async getAllTodosBypassFilter(): Promise<Todo[]> {
    if (!this.loaded) await this.loadAllIndexes();
    return [...this.byId.values()];
  }

  async getById(id: string): Promise<Todo | null> {
    if (!this.loaded) await this.loadAllIndexes();
    return this.byId.get(id) ?? null;
  }

  async getTodosByCategory(categoryId: string | null): Promise<Todo[]> {
    if (!this.loaded) await this.loadAllIndexes();
    const set = this.byCategory.get(categoryId ?? NULL_KEY);
    return set ? [...set] : [];
  }

  async getTodosByProject(projectId: string): Promise<Todo[]> {
    if (!this.loaded) await this.loadAllIndexes();
    const set = this.byProject.get(projectId);
    if (!set) return [];
    // Deduplicate by todo ID (in case of duplicate files)
    const seen = new Set<string>();
    const result: Todo[] = [];
    for (const todo of set) {
      if (!seen.has(todo.id)) {
        seen.add(todo.id);
        result.push(todo);
      }
    }
    return result;
  }

  async getUnboundTodos(): Promise<Todo[]> {
    if (!this.loaded) await this.loadAllIndexes();
    const set = this.byProject.get(NULL_KEY);
    return set ? [...set] : [];
  }

  async getTodosByStatus(status: TodoStatus): Promise<Todo[]> {
    if (!this.loaded) await this.loadAllIndexes();
    const set = this.byStatus.get(status);
    return set ? [...set] : [];
  }

  async getOverdueTodos(): Promise<Todo[]> {
    if (!this.loaded) await this.loadAllIndexes();
    const today = todayStr();
    const result: Todo[] = [];
    for (const todo of this.byId.values()) {
      if (todo.status !== 'done' && todo.dueDate && todo.dueDate < today) result.push(todo);
    }
    return result;
  }

  async searchTodos(keyword: string): Promise<Todo[]> {
    if (!this.loaded) await this.loadAllIndexes();
    if (!keyword.trim()) return [...this.byId.values()];
    const lower = keyword.trim().toLowerCase();
    // 子串匹配：搜索范围包括待办内容、链接
    return [...this.byId.values()].filter(
      (t) => (t.content && t.content.toLowerCase().includes(lower)) || (t.link && t.link.toLowerCase().includes(lower)),
    );
  }

  /** 复合筛选（待办 Tab 用） */
  async queryTodos(filter: {
    categoryId?: string | null;
    projectId?: string | null; // null 表示未绑定项目
    status?: TodoStatus;
    dueDateFrom?: string;
    dueDateTo?: string;
    keyword?: string;
    projectFilter?: 'all' | 'bound' | 'unbound';
    /** 创建日期范围筛选（基于 createdAt 的日期部分） */
    createdDateFrom?: string;
    createdDateTo?: string;
    /** 更新日期范围筛选（基于 updatedAt 的日期部分） */
    updatedDateFrom?: string;
    updatedDateTo?: string;
    /** 负责人筛选（undefined=使用当前全局筛选，空字符串=未分配） */
    responsiblePerson?: string | null;
  }): Promise<Todo[]> {
    // 当显式传入 responsiblePerson 时，绕过全局负责人筛选
    let todos = filter.responsiblePerson !== undefined
      ? await this.getAllTodosBypassFilter()
      : await this.getAllTodos();
    if (filter.categoryId !== undefined) {
      todos = todos.filter((t) => (t.categoryId ?? null) === (filter.categoryId ?? null));
    }
    if (filter.projectFilter === 'bound') {
      todos = todos.filter((t) => t.projectId !== null);
    } else if (filter.projectFilter === 'unbound') {
      todos = todos.filter((t) => t.projectId === null);
    } else if (filter.projectId !== undefined) {
      todos = todos.filter((t) => (t.projectId ?? null) === (filter.projectId ?? null));
    }
    if (filter.status) todos = todos.filter((t) => t.status === filter.status);
    if (filter.dueDateFrom) todos = todos.filter((t) => !!t.dueDate && t.dueDate >= filter.dueDateFrom!);
    if (filter.dueDateTo) todos = todos.filter((t) => !!t.dueDate && t.dueDate <= filter.dueDateTo!);
    if (filter.createdDateFrom) {
      todos = todos.filter((t) => !!t.createdAt && t.createdAt.slice(0, 10) >= filter.createdDateFrom!);
    }
    if (filter.createdDateTo) {
      todos = todos.filter((t) => !!t.createdAt && t.createdAt.slice(0, 10) <= filter.createdDateTo!);
    }
    if (filter.updatedDateFrom) {
      todos = todos.filter((t) => !!t.updatedAt && t.updatedAt.slice(0, 10) >= filter.updatedDateFrom!);
    }
    if (filter.updatedDateTo) {
      todos = todos.filter((t) => !!t.updatedAt && t.updatedAt.slice(0, 10) <= filter.updatedDateTo!);
    }
    if (filter.keyword && filter.keyword.trim()) {
      const keyword = filter.keyword.trim().toLowerCase();
      // 搜索范围：待办内容、链接、项目名
      const projectCache = new Map<string, string>();
      for (const t of todos) {
        if (t.projectId && !projectCache.has(t.projectId)) {
          try {
            const p = await this.plugin.dataService.getProjectById(t.projectId);
            projectCache.set(t.projectId, p?.name ?? '');
          } catch {
            projectCache.set(t.projectId, '');
          }
        }
      }
      const matched = new Set(await this.searchTodos(filter.keyword));
      todos = todos.filter((t) => {
        // 索引搜索匹配（内容、链接）
        if (matched.has(t)) return true;
        // 项目名局部匹配
        if (t.projectId) {
          const pname = projectCache.get(t.projectId) ?? '';
          if (pname.toLowerCase().includes(keyword)) return true;
        }
        return false;
      });
    }
    if (filter.responsiblePerson !== undefined) {
      todos = todos.filter((t) => (t.responsiblePerson || '') === (filter.responsiblePerson || ''));
    }
    return todos;
  }

  // ---------- CRUD ----------
  async create(input: CreateTodoInput): Promise<Todo> {
    await this.ensureFolder();
    const now = nowISO();
    const todo: Todo = {
      id: generateId(),
      content: input.content,
      link: input.link ?? '',
      dueDate: input.dueDate ?? '',
      priority: input.priority ?? '',
      status: input.status ?? 'todo',
      pinned: input.pinned ?? false,
      categoryId: input.categoryId ?? null,
      projectId: input.projectId ?? null,
      responsiblePerson: input.responsiblePerson ?? this.currentResponsiblePerson ?? '',
      completedAt: input.status === 'done' ? now : '',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.writeTodoFile(todo);
    this.indexAdd(todo);
    return todo;
  }

  async update(id: string, data: Partial<Todo>, expectedVersion?: number): Promise<Todo> {
    if (!this.loaded) await this.loadAllIndexes();
    const existing = this.byId.get(id);
    if (!existing) throw new Error(`Todo not found: ${id}`);
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new ConcurrencyConflictError(`待办: ${existing.content}`, existing.version, expectedVersion);
    }
    const oldTodo = { ...existing };
    const updated: Todo = {
      ...existing,
      ...data,
      id: existing.id, // id 不可改
      version: existing.version + 1,
      updatedAt: nowISO(),
    };
    // status 变更处理 completedAt
    if (data.status !== undefined) {
      if (data.status === 'done' && existing.status !== 'done') {
        updated.completedAt = nowISO();
      } else if (data.status !== 'done') {
        updated.completedAt = '';
      }
    }
    await this.writeTodoFile(updated);
    // content 或负责人变了文件路径会变，删除旧文件
    const oldPath = this.getTodoFilePath(oldTodo);
    const newPath = this.getTodoFilePath(updated);
    if (oldPath !== newPath) await this.deleteTodoFile(oldTodo);
    this.indexRemove(existing);
    this.indexAdd(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!this.loaded) await this.loadAllIndexes();
    const existing = this.byId.get(id);
    if (!existing) return;
    await this.deleteTodoFile(existing);
    this.indexRemove(existing);
  }

  /** 项目删除时级联删除其下所有待办 */
  async deleteByProjectId(projectId: string): Promise<void> {
    if (!this.loaded) await this.loadAllIndexes();
    const set = this.byProject.get(projectId);
    if (!set) return;
    const todos = [...set];
    for (const todo of todos) {
      await this.deleteTodoFile(todo);
      this.indexRemove(todo);
    }
  }

  /** 备份恢复用：直接写入/覆盖一个 Todo（不校验版本，保留原 id） */
  async upsertTodo(todo: Todo): Promise<void> {
    await this.ensureFolder();
    const existing = this.byId.get(todo.id);
    if (existing) this.indexRemove(existing);
    await this.writeTodoFile(todo);
    this.indexAdd(todo);
  }

  /** 将某分类下所有待办的 categoryId 置为 null（分类删除时级联调用，避免悬挂引用） */
  async clearCategoryFromTodos(categoryId: string): Promise<void> {
    const todos = await this.getTodosByCategory(categoryId);
    for (const todo of todos) {
      await this.update(todo.id, { categoryId: null });
    }
  }

  /** 项目待办统计（供项目卡片徽章用） */
  async getProjectTodoStats(projectId: string): Promise<{ total: number; completed: number; overdue: number }> {
    const todos = await this.getTodosByProject(projectId);
    const today = todayStr();
    return {
      total: todos.length,
      completed: todos.filter((t) => t.status === 'done').length,
      overdue: todos.filter((t) => t.status !== 'done' && !!t.dueDate && t.dueDate < today).length,
    };
  }
}
