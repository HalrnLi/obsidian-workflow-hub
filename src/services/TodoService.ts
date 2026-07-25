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
 *  - 多维内存索引（byId/byCategory/byProject/byStatus/byDueDate/searchIndex）
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
  private searchIndex = new Map<string, Set<Todo>>();
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

  /** 文件命名：{content前20字符 sanitize}__{id}.md */
  private getTodoFilePath(todo: Pick<Todo, 'id' | 'content'>): string {
    const folder = this.getTodosFolder();
    const name = sanitizeFileName((todo.content || 'untitled').slice(0, 20));
    const fileName = `${name}__${todo.id}.md`;
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

  private clearIndexes(): void {
    this.byId.clear();
    this.byCategory.clear();
    this.byProject.clear();
    this.byStatus.clear();
    this.byDueDate.clear();
    this.byPerson.clear();
    this.searchIndex.clear();
  }

  // ---------- 索引维护 ----------
  private indexAdd(todo: Todo): void {
    this.byId.set(todo.id, todo);
    this.addToSetIndex(this.byCategory, todo.categoryId ?? NULL_KEY, todo);
    this.addToSetIndex(this.byProject, todo.projectId ?? NULL_KEY, todo);
    this.addToSetIndex(this.byStatus, todo.status, todo);
    if (todo.dueDate) this.addToSetIndex(this.byDueDate, todo.dueDate, todo);
    this.addToSetIndex(this.byPerson, todo.responsiblePerson || NULL_KEY, todo);
    this.indexSearchAdd(todo);
  }

  private indexRemove(todo: Todo): void {
    this.byId.delete(todo.id);
    this.removeFromSetIndex(this.byCategory, todo.categoryId ?? NULL_KEY, todo);
    this.removeFromSetIndex(this.byProject, todo.projectId ?? NULL_KEY, todo);
    this.removeFromSetIndex(this.byStatus, todo.status, todo);
    if (todo.dueDate) this.removeFromSetIndex(this.byDueDate, todo.dueDate, todo);
    this.removeFromSetIndex(this.byPerson, todo.responsiblePerson || NULL_KEY, todo);
    this.indexSearchRemove(todo);
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

  // 轻量搜索索引：中文 2-gram + 英文分词
  private indexSearchAdd(todo: Todo): void {
    const tokens = this.tokenize(`${todo.content} ${todo.link}`);
    for (const token of tokens) this.addToSetIndex(this.searchIndex, token, todo);
  }

  private indexSearchRemove(todo: Todo): void {
    const tokens = this.tokenize(`${todo.content} ${todo.link}`);
    for (const token of tokens) this.removeFromSetIndex(this.searchIndex, token, todo);
  }

  private tokenize(text: string): string[] {
    if (!text) return [];
    const tokens = new Set<string>();
    const words = text
      .toLowerCase()
      .split(/[^\w\u4e00-\u9fa5]+/)
      .filter(Boolean);
    for (const w of words) {
      if (/^[a-z0-9]+$/.test(w)) {
        tokens.add(w);
        // 英文数字混合词（如 obsidian123、utf8v2）：额外按字母/数字段分词，
        // 让搜 obsidian 也能匹配 obsidian123
        if (/[a-z]/.test(w) && /\d/.test(w)) {
          const segments = w.match(/[a-z]+|\d+/g);
          if (segments) for (const seg of segments) tokens.add(seg);
        }
      } else {
        // 中文 2-gram 滑动窗口
        for (let i = 0; i < w.length - 1; i++) tokens.add(w.substring(i, i + 2));
        if (w.length === 1) tokens.add(w);
      }
    }
    return [...tokens];
  }

  // ---------- 磁盘读写 ----------
  private async readAllTodosFromDisk(): Promise<Todo[]> {
    const folder = this.getTodosFolder();
    const todos: Todo[] = [];

    if (this.plugin.dataService.pathResolver.isAbsolutePath()) {
      if (!existsSync(folder)) return [];
      for (const item of readdirSync(folder)) {
        const full = join(folder, item);
        try {
          if (statSync(full).isFile() && item.endsWith('.md')) {
            const content = readFileSync(full, 'utf-8');
            const todo = this.parseTodoContent(content);
            if (todo) todos.push(todo);
          }
        } catch (e) {
          console.error('[WorkflowHub] Failed to parse todo file:', full, e);
        }
      }
    } else {
      const prefix = `${folder}/`;
      for (const file of this.plugin.app.vault.getMarkdownFiles()) {
        if (file.path.startsWith(prefix)) {
          try {
            const content = await this.plugin.app.vault.read(file);
            const todo = this.parseTodoContent(content);
            if (todo) todos.push(todo);
          } catch (e) {
            console.error('[WorkflowHub] Failed to parse todo file:', file.path, e);
          }
        }
      }
    }
    return todos;
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
    const filePath = this.getTodoFilePath(todo);
    const content = this.serializeTodo(todo);
    await this.ensureFolder();
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
  }

  private async deleteTodoFile(todo: Pick<Todo, 'id' | 'content'>): Promise<void> {
    const filePath = this.getTodoFilePath(todo);
    if (this.plugin.dataService.pathResolver.isAbsolutePath()) {
      if (existsSync(filePath)) unlinkSync(filePath);
    } else {
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) await this.plugin.app.vault.delete(file);
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
    return set ? [...set] : [];
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
    /** 负责人筛选（undefined=使用当前全局筛选，空字符串=未分配） */
    responsiblePerson?: string | null;
  }): Promise<Todo[]> {
    let todos = await this.getAllTodos();
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
    // content 变了文件名会变，删除旧文件
    if (oldTodo.content !== updated.content) await this.deleteTodoFile(oldTodo);
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
