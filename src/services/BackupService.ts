import { App as ObsidianApp, TFile, TFolder, normalizePath } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import { App, Version, Project, Todo, Category } from '../types';

const DEFAULT_BACKUP_FOLDER = 'workflow-hub/backups';

export class BackupService {
  app: ObsidianApp;
  plugin: AppVersionManagerPlugin;
  private backupTimer: number | null = null;

  constructor(app: ObsidianApp, plugin: AppVersionManagerPlugin) {
    this.app = app;
    this.plugin = plugin;
  }

  private getBackupFolder(): string {
    const customPath = this.plugin.settings.backupPath;
    return customPath ? normalizePath(customPath) : DEFAULT_BACKUP_FOLDER;
  }

  async ensureBackupFolder() {
    const backupFolder = this.getBackupFolder();
    const folder = this.app.vault.getAbstractFileByPath(backupFolder);
    if (!folder) {
      await this.app.vault.createFolder(backupFolder);
    }
  }

  scheduleBackup() {
    this.clearBackupSchedule();

    if (!this.plugin.settings.autoBackup) return;

    const now = new Date();
    const targetDay = this.plugin.settings.backupDay;
    const targetHour = this.plugin.settings.backupHour;

    let daysUntilTarget = targetDay - now.getDay();
    if (daysUntilTarget < 0) {
      daysUntilTarget += 7;
    }

    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + daysUntilTarget);
    targetDate.setHours(targetHour, 0, 0, 0);

    // If the target time has already passed, schedule for next week
    if (targetDate.getTime() <= now.getTime()) {
      targetDate.setDate(targetDate.getDate() + 7);
    }

    const timeUntilBackup = targetDate.getTime() - now.getTime();

    this.backupTimer = window.setTimeout(async () => {
      try {
        await this.performBackup();
      } catch (error) {
        console.error('[AppVersionManager] Scheduled backup failed:', error);
      } finally {
        this.scheduleBackup();
      }
    }, timeUntilBackup);
  }

  clearBackupSchedule() {
    if (this.backupTimer) {
      window.clearTimeout(this.backupTimer);
      this.backupTimer = null;
    }
  }

  async performBackup(): Promise<string> {
    await this.ensureBackupFolder();

    const backupFolder = this.getBackupFolder();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `backup-${timestamp}.json`;
    const backupPath = normalizePath(`${backupFolder}/${backupFileName}`);

    const apps = await this.plugin.dataService.getAllApps();
    const versions = await this.plugin.dataService.getAllVersions();
    const projects = await this.plugin.dataService.getAllProjects();
    const todos = await this.plugin.todoService.getAllTodos();
    const categories = await this.plugin.categoryService.getAll();

    const backupData = {
      backupVersion: 2,
      timestamp: new Date().toISOString(),
      apps,
      versions,
      projects,
      todos,
      categories,
    };

    await this.app.vault.create(backupPath, JSON.stringify(backupData, null, 2));

    this.plugin.settings.lastBackupTime = new Date().toISOString();
    await this.plugin.saveSettings();

    await this.cleanOldBackups();

    return backupPath;
  }

  private async cleanOldBackups() {
    const backupFolder = this.getBackupFolder();
    const folder = this.app.vault.getAbstractFileByPath(backupFolder);
    if (!(folder instanceof TFolder)) return;

    const backupFiles = folder.children
      .filter((f): f is TFile => f instanceof TFile && f.extension === 'json' && f.name.startsWith('backup-'))
      .sort((a, b) => b.name.localeCompare(a.name));

    const maxBackups = 10;
    if (backupFiles.length > maxBackups) {
      for (let i = maxBackups; i < backupFiles.length; i++) {
        try {
          await this.app.vault.delete(backupFiles[i]);
        } catch (error) {
          console.error('[AppVersionManager] Failed to delete backup file:', backupFiles[i].path, error);
        }
      }
    }
  }

  async restoreFromBackup(backupPath: string): Promise<boolean> {
    try {
      const file = this.app.vault.getAbstractFileByPath(backupPath);
      if (!(file instanceof TFile)) return false;

      const content = await this.app.vault.adapter.read(file.path);
      return await this.restoreFromContent(content);
    } catch (error) {
      console.error('[AppVersionManager] Restore from backup failed.', error);
      return false;
    }
  }

  /** 创建回滚函数（供 restoreFromContent 使用） */
  private async createRollbackFn(): Promise<() => Promise<void>> {
    const beforeApps = await this.plugin.dataService.getAllApps();
    const beforeVersions = await this.plugin.dataService.getAllVersions();
    const beforeProjects = await this.plugin.dataService.getAllProjects();
    const beforeTodos = await this.plugin.todoService.getAllTodos();
    const beforeCategories = await this.plugin.categoryService.getAll();

    return async () => {
      for (const app of beforeApps) {
        await this.plugin.dataService.upsertAppRecord(app);
      }
      for (const version of beforeVersions) {
        await this.plugin.dataService.upsertVersionRecord(version);
      }
      for (const project of beforeProjects) {
        await this.plugin.dataService.upsertProjectRecord(project);
      }

      const appIds = new Set(beforeApps.map((a) => a.id));
      const versionIds = new Set(beforeVersions.map((v) => v.id));
      const projectIds = new Set(beforeProjects.map((p) => p.id));

      for (const project of await this.plugin.dataService.getAllProjects()) {
        if (!projectIds.has(project.id)) {
          await this.plugin.dataService.deleteProject(project.id);
        }
      }
      for (const version of await this.plugin.dataService.getAllVersions()) {
        if (!versionIds.has(version.id)) {
          await this.plugin.dataService.deleteVersion(version.id);
        }
      }
      for (const app of await this.plugin.dataService.getAllApps()) {
        if (!appIds.has(app.id)) {
          await this.plugin.dataService.deleteApp(app.id);
        }
      }

      for (const todo of beforeTodos) {
        await this.plugin.todoService.upsertTodo(todo);
      }
      for (const category of beforeCategories) {
        await this.plugin.categoryService.upsertCategory(category);
      }
      const todoIds = new Set(beforeTodos.map((t) => t.id));
      const categoryIds = new Set(beforeCategories.map((c) => c.id));
      for (const todo of await this.plugin.todoService.getAllTodos()) {
        if (!todoIds.has(todo.id)) {
          await this.plugin.todoService.delete(todo.id);
        }
      }
      for (const category of await this.plugin.categoryService.getAll()) {
        if (!categoryIds.has(category.id)) {
          await this.plugin.categoryService.delete(category.id);
        }
      }
    };
  }

  async restoreFromContent(content: string, rollback?: () => Promise<void>): Promise<boolean> {
    const doRollback = rollback || (await this.createRollbackFn());

    try {
      const backupData = JSON.parse(content);

      const { apps, versions, projects } = backupData as {
        apps: App[];
        versions: Version[];
        projects: Project[];
      };
      if (!Array.isArray(apps) || !Array.isArray(versions) || !Array.isArray(projects)) {
        throw new Error('Invalid backup payload');
      }

      for (const app of apps) {
        await this.plugin.dataService.upsertAppRecord(app);
      }

      for (const version of versions) {
        await this.plugin.dataService.upsertVersionRecord(version);
      }

      for (const project of projects) {
        await this.plugin.dataService.upsertProjectRecord(project);
      }

      // 恢复待办与分类（若备份包含，向后兼容旧备份）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const todos = (backupData as any).todos;
      if (Array.isArray(todos)) {
        let todoCount = 0;
        for (const todo of todos) {
          if (todo?.id && todo?.content) {
            await this.plugin.todoService.upsertTodo(todo);
            todoCount++;
          }
        }
        console.log(`[WorkflowHub] 恢复 ${todoCount} 条待办`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const categories = (backupData as any).categories;
      if (Array.isArray(categories)) {
        let catCount = 0;
        for (const category of categories) {
          if (category?.id && category?.name) {
            await this.plugin.categoryService.upsertCategory(category);
            catCount++;
          }
        }
        console.log(`[WorkflowHub] 恢复 ${catCount} 个分类`);
      }

      // 刷新索引
      await this.plugin.todoService.invalidateAll();
      await this.plugin.categoryService.invalidateAll();
      // 失效 DataService 缓存，避免恢复后读到旧数据（apps/versions/projects/project:{id}）
      this.plugin.dataService.cache.invalidate();

      return true;
    } catch (error) {
      console.error('[AppVersionManager] Restore from content failed, rolling back changes.', error);
      try {
        await doRollback();
      } catch (rollbackError) {
        console.error('[AppVersionManager] Rollback after restore failure also failed.', rollbackError);
      }
      return false;
    }
  }

  async getBackupList(): Promise<{ name: string; path: string; date: Date }[]> {
    const backupFolder = this.getBackupFolder();
    const folder = this.app.vault.getAbstractFileByPath(backupFolder);
    if (!(folder instanceof TFolder)) return [];

    return folder.children
      .filter((f) => (f as any).extension === 'json' && f.name.startsWith('backup-'))
      .map((f) => ({
        name: f.name,
        path: f.path,
        date: new Date((f as any).stat.mtime),
      }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }
}
