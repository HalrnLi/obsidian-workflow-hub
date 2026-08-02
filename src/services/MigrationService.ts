import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'fs';
import { join, isAbsolute } from 'path';
import { normalizePath } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import { Todo, TodoStatus, TodoPriority, ProjectInfoItem } from '../types';
import { parseFrontmatter, createFrontmatter, parseProgressHistory } from '../utils/frontmatter';
import { generateId, sanitizeFileName } from '../utils/idUtils';
import { nowISO, toISO } from '../utils/dateUtils';

/** 迁移日志条目 */
interface MigrationLogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
}

/**
 * 数据迁移服务。
 *
 * 迁移源：
 *  1. todolist 插件的 tasks.json（<vault>/.obsidian/plugins/todolist/tasks.json）→ 新 Todo 文件（无项目绑定）
 *  2. AVM 旧数据（{oldDataPath}/apps|versions|projects，含 projects/todos__{projectId}.md）→ 新格式
 *
 * 迁移规则详见 docs/migration-rules.md。
 *
 * 旧数据处理：
 *  - AVM 备忘录(memos/) → 丢弃
 *  - AVM 规划(plans/) → 丢弃（规划功能已移除）
 *  - todolist 临时待办/提醒 → 丢弃（纯内存特性）
 */
export class MigrationService {
  private plugin: AppVersionManagerPlugin;
  private logs: MigrationLogEntry[] = [];
  /** 旧 AVM 数据路径（默认 'app-version-manager'） */
  private oldDataPath = 'app-version-manager';
  /** todolist tasks.json 路径（相对 vault） */
  private todolistTasksPath = '.obsidian/plugins/todolist/tasks.json';

  constructor(plugin: AppVersionManagerPlugin) {
    this.plugin = plugin;
  }

  /** 设置旧数据路径（覆盖默认值） */
  setOldDataPath(path: string): void {
    this.oldDataPath = path;
  }

  private log(level: MigrationLogEntry['level'], message: string): void {
    this.logs.push({ level, message });
    if (level === 'error') console.error(`[Migration] ${message}`);
    else if (level === 'warn') console.warn(`[Migration] ${message}`);
    else console.log(`[Migration] ${message}`);
  }

  private isAbsolutePath(path: string): boolean {
    return isAbsolute(path) || /^[A-Za-z]:/.test(path);
  }

  private getNewDataPath(): string {
    return this.plugin.settings.dataPath || 'workflow-hub';
  }

  /** 主入口：编排整个迁移流程 */
  async run(): Promise<void> {
    this.log('info', '开始数据迁移...');
    // 清除上次的错误记录
    this.plugin.settings.migrationError = null;

    const newDataPath = this.getNewDataPath();
    if (newDataPath === this.oldDataPath) {
      this.log(
        'warn',
        `新数据路径与旧 AVM 路径相同（${newDataPath}），建议在设置中将 dataPath 改为不同值（如 workflow-hub）以避免混淆`,
      );
    }
    const timestamp = Date.now();

    try {
      // 1. 备份旧数据
      await this.backupOriginalData(newDataPath, timestamp);

      // 2. 迁移 AVM 实体（App/Version/Project）
      const avmStats = await this.migrateAVMEntities(newDataPath);

      // 3. 迁移 AVM 待办（todos__{projectId}.md → 独立 Todo 文件）
      const avmTodoStats = await this.migrateAVMTodos(newDataPath);

      // 4. 迁移 todolist tasks.json
      const todolistStats = await this.migrateTodolist(newDataPath);

      // 5. 写迁移日志
      await this.writeMigrationLog(newDataPath, timestamp);

      // 6. 自检
      const verified = this.verify({
        avmApps: avmStats.apps,
        avmVersions: avmStats.versions,
        avmProjects: avmStats.projects,
        avmTodos: avmTodoStats,
        todolistTodos: todolistStats,
      });

      if (!verified) {
        this.log('error', '迁移自检失败，请检查日志并从备份恢复');
        this.plugin.settings.migrationError = '迁移自检失败，请检查日志';
        await this.plugin.saveSettings();
        return;
      }

      // 注意：不清理旧数据，保留原始文件不动

      // 7. 标记完成 + 刷新索引
      this.plugin.settings.migrationCompleted = true;
      await this.plugin.saveSettings();
      await this.plugin.todoService.invalidateAll();
      await this.plugin.categoryService.invalidateAll();
      // 失效 DataService 缓存，避免迁移后（尤其设置页手动重迁时）读到旧数据
      this.plugin.dataService.cache.invalidate();

      this.log('info', '数据迁移完成');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log('error', `迁移失败: ${msg}`);
      this.plugin.settings.migrationError = msg;
      await this.plugin.saveSettings();
    }
  }

  // ---------- 备份 ----------
  private async backupOriginalData(newDataPath: string, timestamp: number): Promise<void> {
    // 备份目录放在 vault 根目录（避免在 dataPath 内部，防止迁移覆盖备份）
    const backupDir = `_migration_backup_${timestamp}`;
    this.log('info', `备份旧数据到 ${backupDir}`);

    try {
      // 备份 AVM 旧数据（支持 vault 相对路径和绝对路径）
      if (!this.hasOldData(this.oldDataPath)) {
        this.log('warn', `未找到旧数据目录: ${this.oldDataPath}，跳过备份`);
      } else if (this.isOldAbsolutePath(this.oldDataPath)) {
        // 绝对路径：使用 fs 复制到 vault 内备份目录
        await this.copyAbsolutePathFolder(this.oldDataPath, backupDir + '/avm');
      } else {
        const oldFolder = this.plugin.app.vault.getAbstractFileByPath(this.oldDataPath);
        if (oldFolder) {
          await this.copyVaultFolder(this.oldDataPath, backupDir + '/avm');
        }
      }

      // 备份 todolist tasks.json
      const todolistContent = await this.readTodolistTasks();
      if (todolistContent) {
        await this.ensureFolder(backupDir + '/todolist');
        await this.plugin.app.vault.create(`${backupDir}/todolist/tasks.json`, todolistContent);
        this.log('info', '已备份 todolist tasks.json');
      }
    } catch (e) {
      this.log('warn', `备份过程出错（可继续）: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 读取 todolist tasks.json（支持绝对路径和 vault 相对路径） */
  private async readTodolistTasks(): Promise<string | null> {
    if (this.isOldAbsolutePath(this.todolistTasksPath)) {
      if (existsSync(this.todolistTasksPath)) {
        return readFileSync(this.todolistTasksPath, 'utf-8');
      }
      return null;
    }
    const file = this.plugin.app.vault.getAbstractFileByPath(this.todolistTasksPath);
    if (file) return await this.plugin.app.vault.read(file as any);
    return null;
  }

  /** 复制绝对路径文件夹到 vault 内 */
  private async copyAbsolutePathFolder(src: string, dst: string): Promise<void> {
    if (!existsSync(src)) return;
    const items = readdirSync(src);
    for (const item of items) {
      const fullPath = join(src, item);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        await this.copyAbsolutePathFolder(fullPath, `${dst}/${item}`);
      } else {
        const content = readFileSync(fullPath, 'utf-8');
        const dstPath = `${dst}/${item}`;
        const dstDir = dstPath.substring(0, Math.max(dstPath.lastIndexOf('/'), dstPath.lastIndexOf('\\')));
        if (dstDir) await this.ensureFolder(dstDir);
        await this.plugin.app.vault.create(dstPath, content).catch(() => {});
      }
    }
  }

  private async copyVaultFolder(src: string, dst: string): Promise<void> {
    await this.ensureFolder(dst);
    const files = this.plugin.app.vault.getFiles();
    const prefix = src.endsWith('/') ? src : src + '/';
    for (const file of files) {
      if (file.path.startsWith(prefix)) {
        const rel = file.path.substring(prefix.length);
        const content = await this.plugin.app.vault.adapter.read(file.path);
        const dstPath = `${dst}/${rel}`;
        const dstDir = dstPath.substring(0, Math.max(dstPath.lastIndexOf('/'), dstPath.lastIndexOf('\\')));
        if (dstDir) await this.ensureFolder(dstDir);
        await this.plugin.app.vault.create(dstPath, content).catch(() => {});
      }
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    if (this.isAbsolutePath(path)) {
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
      }
    } else {
      if (!this.plugin.app.vault.getAbstractFileByPath(path)) {
        await this.plugin.app.vault.createFolder(path).catch(() => {});
      }
    }
  }

  // ---------- AVM 实体迁移 ----------
  private async migrateAVMEntities(newDataPath: string): Promise<{ apps: number; versions: number; projects: number }> {
    let apps = 0,
      versions = 0,
      projects = 0;
    const oldPath = this.oldDataPath;

    // apps
    const appFiles = await this.listOldMarkdownFiles(`${oldPath}/apps`);
    for (const { content, relativePath } of appFiles) {
      try {
        const fm = parseFrontmatter(content);
        if (!fm?.id) continue;
        const newFm = {
          id: String(fm.id),
          name: fm.name ?? '',
          createdAt: toISO(fm.createdAt),
          updatedAt: toISO(fm.updatedAt),
          version: Number(fm.version ?? 1),
        };
        await this.writeNewFile(
          this.newFilePath(newDataPath, 'apps', String(fm.name ?? 'unnamed'), String(fm.id)),
          createFrontmatter(newFm),
        );
        apps++;
      } catch (e) {
        this.log('warn', `迁移 App 失败 ${relativePath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // versions
    const versionFiles = await this.listOldMarkdownFiles(`${oldPath}/versions`);
    for (const { content, relativePath } of versionFiles) {
      try {
        const fm = parseFrontmatter(content);
        if (!fm?.id) continue;
        const newFm = {
          id: String(fm.id),
          appId: String(fm.appId ?? ''),
          versionNumber: String(fm.versionNumber ?? ''),
          bllVersion: String(fm.bllVersion ?? ''),
          ippVersion: String(fm.ippVersion ?? ''),
          webVersion: String(fm.webVersion ?? ''),
          updateContent: String(fm.updateContent ?? ''),
          isArchived: Boolean(fm.isArchived),
          createdAt: toISO(fm.createdAt),
          updatedAt: toISO(fm.updatedAt),
          version: Number(fm.version ?? 1),
        };
        const baseName = sanitizeFileName(`${fm.appId ?? 'app'}_${fm.versionNumber ?? 'ver'}`);
        await this.writeNewFile(
          this.newFilePath(newDataPath, 'versions', baseName, String(fm.id)),
          createFrontmatter(newFm),
        );
        versions++;
      } catch (e) {
        this.log('warn', `迁移 Version 失败 ${relativePath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // projects（加 projectInfo: []，时间戳转 ISO，progressHistory.changedAt 转 ISO）
    const projectFiles = await this.listOldMarkdownFiles(`${oldPath}/projects`);
    for (const { content, relativePath } of projectFiles) {
      // 跳过 todos__*.md（待办集中文件，单独迁移）
      if (relativePath.includes('todos__')) continue;
      try {
        const fm = parseFrontmatter(content);
        if (!fm?.id) continue;
        const progressHistory = parseProgressHistory(fm.progressHistory).map((h) => ({
          progress: h.progress,
          changedAt: toISO(h.changedAt),
        }));
        // 保留旧数据中的 APP+版本关联（若存在）
        let preservedLinks: Record<string, string>[] = [];
        if (fm.appVersionLinks && Array.isArray(fm.appVersionLinks)) {
          preservedLinks = fm.appVersionLinks.map((l: Record<string, string>) => ({
            appId: String(l.appId ?? ''),
            versionId: String(l.versionId ?? ''),
          })).filter((l: Record<string, string>) => l.appId && l.versionId);
        }
        const newFm: Record<string, unknown> = {
          id: String(fm.id),
          name: String(fm.name ?? ''),
          appVersionLinks: preservedLinks,
          manager: String(fm.manager ?? ''),
          responsiblePerson: String(fm.responsiblePerson ?? ''),
          projectLink: String(fm.projectLink ?? ''),
          componentLink: String(fm.componentLink ?? ''),
          features: String(fm.features ?? ''),
          spec: String(fm.spec ?? ''),
          requirements: String(fm.requirements ?? ''),
          progress: String(fm.progress ?? ''),
          progressHistory: progressHistory.map((h) => `${h.progress}@${h.changedAt}`),
          b1IntegrationTestTime: String(fm.b1IntegrationTestTime ?? ''),
          b1SystemTestTime: String(fm.b1SystemTestTime ?? ''),
          b2IntegrationTestTime: String(fm.b2IntegrationTestTime ?? ''),
          b2SystemTestTime: String(fm.b2SystemTestTime ?? ''),
          b3IntegrationTestTime: String(fm.b3IntegrationTestTime ?? ''),
          b3SystemTestTime: String(fm.b3SystemTestTime ?? ''),
          b4IntegrationTestTime: String(fm.b4IntegrationTestTime ?? ''),
          b4SystemTestTime: String(fm.b4SystemTestTime ?? ''),
          actualReleaseTime: String(fm.actualReleaseTime ?? ''),
          projectInfo: [] as ProjectInfoItem[],
          createdAt: toISO(fm.createdAt),
          updatedAt: toISO(fm.updatedAt),
          version: Number(fm.version ?? 1),
        };
        await this.writeNewFile(
          this.newFilePath(newDataPath, 'projects', sanitizeFileName(String(fm.name ?? 'unnamed')), String(fm.id)),
          createFrontmatter(newFm),
        );
        projects++;
      } catch (e) {
        this.log('warn', `迁移 Project 失败 ${relativePath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    this.log('info', `AVM 实体迁移: ${apps} apps, ${versions} versions, ${projects} projects`);
    return { apps, versions, projects };
  }

  // ---------- AVM 待办迁移（todos__{projectId}.md → 独立 Todo 文件） ----------
  private async migrateAVMTodos(newDataPath: string): Promise<number> {
    let count = 0;
    const oldPath = this.oldDataPath;
    const todoFiles = await this.listOldMarkdownFiles(`${oldPath}/projects`);
    const todosFiles = todoFiles.filter((p) => p.relativePath.includes('todos__'));

    for (const { content, relativePath } of todosFiles) {
      try {
        const fm = parseFrontmatter(content);
        const todos = (fm?.todos || []) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const todo of todos) {
          const converted = this.convertAVMTodo(todo);
          if (converted) {
            await this.writeNewTodo(newDataPath, converted);
            count++;
          }
        }
      } catch (e) {
        this.log('warn', `迁移 AVM 待办失败 ${relativePath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    this.log('info', `AVM 待办迁移: ${count} todos`);
    return count;
  }

  /** AVM Todo → 新 Todo（逐字段映射，见迁移规则 F.3） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private convertAVMTodo(todo: any): Todo | null {
    if (!todo || !todo.content || !String(todo.content).trim()) {
      this.log('warn', '跳过空 content 的 AVM 待办');
      return null;
    }
    const id = todo.id ? String(todo.id) : generateId();
    const completed = Boolean(todo.completed);
    const status: TodoStatus = completed ? 'done' : 'todo';
    const updatedAt = toISO(todo.updatedAt) || toISO(todo.createdAt) || nowISO();
    return {
      id,
      content: String(todo.content),
      link: todo.link ? String(todo.link) : '',
      dueDate: todo.dueDate ? String(todo.dueDate) : '',
      priority: '' as TodoPriority,
      status,
      pinned: false,
      categoryId: null,
      projectId: todo.projectId ? String(todo.projectId) : null,
      responsiblePerson: '',
      completedAt: completed ? updatedAt : '',
      createdAt: toISO(todo.createdAt) || updatedAt,
      updatedAt,
      version: Number(todo.version ?? 1),
    };
  }

  // ---------- todolist tasks.json 迁移 ----------
  private async migrateTodolist(newDataPath: string): Promise<number> {
    let count = 0;
    const content = await this.readTodolistTasks();

    if (!content) {
      this.log('info', '未找到 todolist tasks.json，跳过 todolist 迁移');
      return 0;
    }

    try {
      const data = JSON.parse(content);
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      for (const dateTask of tasks) {
        const tasksList = Array.isArray(dateTask?.tasksList) ? dateTask.tasksList : [];
        for (const task of tasksList) {
          const converted = this.convertTodolistTask(task);
          if (converted) {
            await this.writeNewTodo(newDataPath, converted);
            count++;
          }
        }
      }
    } catch (e) {
      this.log('error', `解析 todolist tasks.json 失败: ${e instanceof Error ? e.message : String(e)}`);
    }

    this.log('info', `todolist 待办迁移: ${count} todos`);
    return count;
  }

  /** todolist Task → 新 Todo（逐字段映射，见迁移规则 F.2） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private convertTodolistTask(task: any): Todo | null {
    if (!task || !task.content || !String(task.content).trim()) {
      this.log('warn', '跳过空 content 的 todolist 待办');
      return null;
    }
    const id = task.taskId ? String(task.taskId) : generateId();
    const completed = Boolean(task.completed);
    const status: TodoStatus = completed ? 'done' : 'todo';
    const createdAt = toISO(task.createAt) || nowISO();
    return {
      id,
      content: String(task.content), // 保留原文本（含 #tag，不剥离）
      link: task.link ? String(task.link) : '',
      dueDate: task.dueDate ? String(task.dueDate) : '',
      priority: this.normalizePriority(task.priority),
      status,
      pinned: false,
      categoryId: null, // 迁移来的待办默认未分类
      projectId: null, // todolist 无项目概念
      responsiblePerson: '', // 迁移来的待办默认无负责人
      completedAt: completed ? createdAt : '',
      createdAt,
      updatedAt: createdAt, // todolist 无 updatedAt，用 createdAt 兜底
      version: 1,
    };
  }

  private normalizePriority(p: unknown): TodoPriority {
    if (p === 'high' || p === 'medium' || p === 'low') return p;
    return '';
  }

  // ---------- 文件读写工具 ----------

  /** 判断路径是否为绝对路径 */
  private isOldAbsolutePath(path: string): boolean {
    return isAbsolute(path) || /^[A-Za-z]:/.test(path);
  }

  /**
   * 列出旧目录下的所有 .md 文件。
   * 支持 vault 相对路径和绝对路径。
   * 返回统一格式：{ content: string; relativePath: string; isAbsolute: boolean }
   */
  private async listOldMarkdownFiles(
    folderPath: string,
  ): Promise<Array<{ content: string; relativePath: string; isAbsolute: boolean }>> {
    const result: Array<{ content: string; relativePath: string; isAbsolute: boolean }> = [];

    if (this.isOldAbsolutePath(folderPath)) {
      // 绝对路径：使用 fs 读取
      if (!existsSync(folderPath)) return result;
      const items = readdirSync(folderPath);
      for (const item of items) {
        if (!item.endsWith('.md')) continue;
        const fullPath = join(folderPath, item);
        try {
          if (statSync(fullPath).isFile()) {
            const content = readFileSync(fullPath, 'utf-8');
            result.push({ content, relativePath: fullPath, isAbsolute: true });
          }
        } catch (e) {
          this.log('warn', `读取旧文件失败: ${fullPath}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } else {
      // vault 相对路径
      try {
        const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        if (folder) {
          const files = this.plugin.app.vault.getMarkdownFiles();
          const prefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';
          for (const f of files) {
            if (f.path.startsWith(prefix)) {
              const content = await this.plugin.app.vault.read(f);
              result.push({ content, relativePath: f.path, isAbsolute: false });
            }
          }
        }
      } catch (e) {
        this.log('warn', `读取旧目录失败: ${folderPath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return result;
  }

  /** 检查指定路径是否存在旧数据 */
  hasOldData(path: string): boolean {
    if (this.isOldAbsolutePath(path)) {
      return existsSync(path);
    }
    const folder = this.plugin.app.vault.getAbstractFileByPath(path);
    return folder !== null;
  }

  private newFilePath(dataPath: string, subfolder: string, name: string, id: string): string {
    const fileName = `${sanitizeFileName(name)}__${id}.md`;
    // Use proper path joining for both relative and absolute paths
    return this.isAbsolutePath(dataPath)
      ? join(dataPath, subfolder, fileName)
      : normalizePath(`${dataPath}/${subfolder}/${fileName}`);
  }

  private async writeNewFile(path: string, content: string): Promise<void> {
    const dir = path.substring(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
    await this.ensureFolder(dir);
    if (this.isAbsolutePath(path)) {
      writeFileSync(path, content, 'utf-8');
    } else {
      const existing = this.plugin.app.vault.getAbstractFileByPath(path);
      if (existing) {
        await this.plugin.app.vault.modify(existing as any, content);
      } else {
        await this.plugin.app.vault.create(path, content);
      }
    }
  }

  private async writeNewTodo(dataPath: string, todo: Todo): Promise<void> {
    const name = sanitizeFileName((todo.content || 'untitled').slice(0, 20));
    const fileName = `${name}__${todo.id}.md`;
    const path = this.isAbsolutePath(dataPath)
      ? join(dataPath, 'todos', fileName)
      : normalizePath(`${dataPath}/todos/${fileName}`);
    const fm = createFrontmatter({
      id: todo.id,
      content: todo.content,
      link: todo.link,
      dueDate: todo.dueDate,
      priority: todo.priority,
      status: todo.status,
      categoryId: todo.categoryId,
      projectId: todo.projectId,
      completedAt: todo.completedAt,
      createdAt: todo.createdAt,
      updatedAt: todo.updatedAt,
      version: todo.version,
    });
    await this.writeNewFile(path, fm);
  }

  // ---------- 日志与自检 ----------
  private async writeMigrationLog(dataPath: string, timestamp: number): Promise<void> {
    const logPath = this.isAbsolutePath(dataPath)
      ? join(dataPath, `_migration_${timestamp}.log`)
      : normalizePath(`${dataPath}/_migration_${timestamp}.log`);
    const logContent = this.logs.map((l) => `[${l.level.toUpperCase()}] ${l.message}`).join('\n');
    try {
      await this.writeNewFile(logPath, logContent);
    } catch {
      // ignore
    }
  }

  private verify(stats: {
    avmApps: number;
    avmVersions: number;
    avmProjects: number;
    avmTodos: number;
    todolistTodos: number;
  }): boolean {
    const totalTodos = stats.avmTodos + stats.todolistTodos;
    this.log(
      'info',
      `自检: ${stats.avmApps} apps, ${stats.avmVersions} versions, ${stats.avmProjects} projects, ${totalTodos} todos`,
    );
    // 基本自检：无严重错误即通过，但存在警告时记录提示（更严格的数量对比可在实际数据上做）
    const hasError = this.logs.some((l) => l.level === 'error');
    const hasWarn = this.logs.some((l) => l.level === 'warn');
    if (hasWarn) {
      this.log('info', `自检注意: 迁移过程中存在 ${this.logs.filter((l) => l.level === 'warn').length} 条警告，请检查迁移日志`);
    }
    return !hasError;
  }
}
