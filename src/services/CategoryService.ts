import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';
import { normalizePath, TFile } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import { Category, CreateCategoryInput, ConcurrencyConflictError } from '../types';
import { parseFrontmatter, createFrontmatter, parseNumericField } from '../utils/frontmatter';
import { generateId, sanitizeFileName } from '../utils/idUtils';
import { nowISO } from '../utils/dateUtils';

/** 首次启动初始化的默认分类 */
const DEFAULT_CATEGORIES: { name: string; sortOrder: number; color: string }[] = [
  { name: '工作', sortOrder: 0, color: '#ef4444' },
  { name: '学习', sortOrder: 1, color: '#3b82f6' },
  { name: '生活', sortOrder: 2, color: '#10b981' },
];

/**
 * 分类管理服务（新增）。
 * 职责：分类 CRUD + 默认分类初始化 + 内存索引（byId / 按 sortOrder 排序）。
 * 每个分类独立一个 .md 文件，存储于 {dataPath}/categories/。
 * 未分类由 categoryId=null 表示，不创建实体。
 */
export class CategoryService {
  private plugin: AppVersionManagerPlugin;
  private byId = new Map<string, Category>();
  private sorted: Category[] = [];
  private loaded = false;

  constructor(plugin: AppVersionManagerPlugin) {
    this.plugin = plugin;
  }

  private getDataPath(): string {
    return this.plugin.settings.dataPath || 'workflow-hub';
  }

  private getCategoriesFolder(): string {
    const dataPath = this.getDataPath();
    return this.plugin.dataService.pathResolver.isAbsolutePath()
      ? this.plugin.dataService.pathResolver.joinPath(dataPath, 'categories')
      : `${dataPath}/categories`;
  }

  private getCategoryFilePath(category: Pick<Category, 'id' | 'name'>): string {
    const folder = this.getCategoriesFolder();
    const name = sanitizeFileName(category.name || 'unnamed');
    const fileName = `${name}__${category.id}.md`;
    return this.plugin.dataService.pathResolver.isAbsolutePath()
      ? this.plugin.dataService.pathResolver.joinPath(folder, fileName)
      : normalizePath(`${folder}/${fileName}`);
  }

  // ---------- 加载 ----------
  async loadAll(): Promise<void> {
    if (this.loaded) return;
    this.byId.clear();
    const categories = await this.readAllFromDisk();
    for (const c of categories) this.byId.set(c.id, c);
    this.rebuildSorted();
    this.loaded = true;
  }

  /** 首次启动初始化默认分类（已存在分类则跳过） */
  async initializeDefaults(): Promise<void> {
    await this.loadAll();
    if (this.byId.size > 0) return;
    for (const def of DEFAULT_CATEGORIES) {
      await this.create({ name: def.name, sortOrder: def.sortOrder });
    }
  }

  async invalidateAll(): Promise<void> {
    this.loaded = false;
    await this.loadAll();
  }

  /** 切换数据路径时重置索引状态 */
  resetPath(): void {
    this.loaded = false;
    this.byId.clear();
    this.sorted = [];
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
      if (path.startsWith(this.getCategoriesFolder() + '/')) {
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
      this.invalidateAll().catch((e) => console.error('[WorkflowHub] 分类索引重建失败:', e));
    }, CategoryService.REBUILD_DEBOUNCE_MS);
  }

  private rebuildSorted(): void {
    this.sorted = [...this.byId.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
    );
  }

  // ---------- 查询 ----------
  async getAll(): Promise<Category[]> {
    await this.loadAll();
    return [...this.sorted];
  }

  async getById(id: string): Promise<Category | null> {
    await this.loadAll();
    return this.byId.get(id) ?? null;
  }

  // ---------- CRUD ----------
  async create(input: CreateCategoryInput): Promise<Category> {
    await this.loadAll();
    const existing = [...this.byId.values()];
    if (existing.some((c) => c.name === input.name)) {
      throw new Error(`分类名称已存在: ${input.name}`);
    }
    const now = nowISO();
    const sortOrder = input.sortOrder ?? (existing.length > 0 ? Math.max(...existing.map((c) => c.sortOrder)) + 1 : 0);
    const category: Category = {
      id: generateId(),
      name: input.name,
      sortOrder,
      color: input.color ?? '#64748b',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.ensureFolder();
    await this.writeCategoryFile(category);
    this.byId.set(category.id, category);
    this.rebuildSorted();
    return category;
  }

  async update(
    id: string,
    data: Partial<Pick<Category, 'name' | 'sortOrder' | 'color'>>,
    expectedVersion?: number,
  ): Promise<Category> {
    await this.loadAll();
    const existing = this.byId.get(id);
    if (!existing) throw new Error(`分类不存在: ${id}`);
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new ConcurrencyConflictError(`分类: ${existing.name}`, existing.version, expectedVersion);
    }
    if (data.name && data.name !== existing.name) {
      if ([...this.byId.values()].some((c) => c.name === data.name && c.id !== id)) {
        throw new Error(`分类名称已存在: ${data.name}`);
      }
    }
    const oldFile = { ...existing };
    const updated: Category = {
      ...existing,
      name: data.name ?? existing.name,
      sortOrder: data.sortOrder ?? existing.sortOrder,
      color: data.color ?? existing.color,
      version: existing.version + 1,
      updatedAt: nowISO(),
    };
    await this.writeCategoryFile(updated);
    if (oldFile.name !== updated.name) await this.deleteCategoryFile(oldFile);
    this.byId.set(id, updated);
    this.rebuildSorted();
    return updated;
  }

  /** 原子交换两个分类的 sortOrder（上/下移操作） */
  async swapSortOrder(idA: string, idB: string): Promise<void> {
    await this.loadAll();
    const a = this.byId.get(idA);
    const b = this.byId.get(idB);
    if (!a || !b) throw new Error('分类不存在');

    const tempOrder = a.sortOrder;
    a.sortOrder = b.sortOrder;
    b.sortOrder = tempOrder;

    const now = nowISO();
    a.version += 1;
    b.version += 1;
    a.updatedAt = now;
    b.updatedAt = now;

    await this.writeCategoryFile(a);
    await this.writeCategoryFile(b);

    this.byId.set(idA, a);
    this.byId.set(idB, b);
    this.rebuildSorted();
  }

  async delete(id: string): Promise<void> {
    await this.loadAll();
    const existing = this.byId.get(id);
    if (!existing) return;
    // 级联：把该分类下所有待办的 categoryId 置 null，避免悬挂引用
    await this.plugin.todoService.clearCategoryFromTodos(id);
    await this.deleteCategoryFile(existing);
    this.byId.delete(id);
    this.rebuildSorted();
  }

  /** 备份恢复用：直接写入/覆盖一个分类（不校验版本，保留原 id） */
  async upsertCategory(category: Category): Promise<void> {
    await this.ensureFolder();
    await this.writeCategoryFile(category);
    this.byId.set(category.id, category);
    this.rebuildSorted();
  }

  // ---------- 磁盘读写 ----------
  private async readAllFromDisk(): Promise<Category[]> {
    const folder = this.getCategoriesFolder();
    const categories: Category[] = [];
    if (this.plugin.dataService.pathResolver.isAbsolutePath()) {
      if (!existsSync(folder)) return [];
      for (const item of readdirSync(folder)) {
        const full = join(folder, item);
        try {
          if (statSync(full).isFile() && item.endsWith('.md')) {
            const content = readFileSync(full, 'utf-8');
            const c = this.parseCategoryContent(content);
            if (c) categories.push(c);
          }
        } catch (e) {
          console.error('[WorkflowHub] Failed to parse category file:', full, e);
        }
      }
    } else {
      const prefix = `${folder}/`;
      for (const file of this.plugin.app.vault.getMarkdownFiles()) {
        if (file.path.startsWith(prefix)) {
          try {
            const content = await this.plugin.app.vault.adapter.read(file.path);
            const c = this.parseCategoryContent(content);
            if (c) categories.push(c);
          } catch (e) {
            console.error('[WorkflowHub] Failed to parse category file:', file.path, e);
          }
        }
      }
    }
    return categories;
  }

  private parseCategoryContent(content: string): Category | null {
    const fm = parseFrontmatter(content);
    if (!fm || !fm.id) return null;
    return {
      id: String(fm.id),
      name: fm.name ?? '',
      sortOrder: parseNumericField(fm.sortOrder, 0),
      color: fm.color ? String(fm.color) : '#64748b',
      createdAt: fm.createdAt ?? '',
      updatedAt: fm.updatedAt ?? '',
      version: parseNumericField(fm.version, 1),
    };
  }

  private serializeCategory(category: Category): string {
    return createFrontmatter({
      id: category.id,
      name: category.name,
      sortOrder: category.sortOrder,
      color: category.color,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
      version: category.version,
    });
  }

  private async writeCategoryFile(category: Category): Promise<void> {
    // 自身写操作标记：vault 事件触发时跳过索引重建
    this.selfWriteDepth++;
    try {
      const filePath = this.getCategoryFilePath(category);
      const content = this.serializeCategory(category);
      await this.ensureFolder();
      if (this.plugin.dataService.pathResolver.isAbsolutePath()) {
        writeFileSync(filePath, content, 'utf-8');
      } else {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) await this.plugin.app.vault.modify(file, content);
        else await this.plugin.app.vault.create(filePath, content);
      }
    } finally {
      this.selfWriteDepth--;
    }
  }

  private async deleteCategoryFile(category: Pick<Category, 'id' | 'name'>): Promise<void> {
    this.selfWriteDepth++;
    try {
      const filePath = this.getCategoryFilePath(category);
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
    const folder = this.getCategoriesFolder();
    if (this.plugin.dataService.pathResolver.isAbsolutePath()) {
      if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
    } else {
      if (!this.plugin.app.vault.getAbstractFileByPath(folder)) {
        await this.plugin.app.vault.createFolder(folder).catch(() => {});
      }
    }
  }
}
