import { App as ObsidianApp, TFile, TFolder, normalizePath } from 'obsidian';
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, unlinkSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { join, basename, extname } from 'path';
import AppVersionManagerPlugin from '../main';
import {
  App,
  Version,
  Project,
  ProjectLink,
  ProjectProgress,
  ConcurrencyConflictError,
  getProgressOrder,
  getFirstProgress,
} from '../types';
import { DataCache } from '../utils/DataCache';
import { parseFrontmatter, createFrontmatter } from '../utils/frontmatter';
import { generateId, sanitizeFileName, compareVersions } from '../utils/idUtils';
import { nowISO } from '../utils/dateUtils';
import { FilePathResolver } from '../utils/FilePathResolver';
import {
  parseProjectLinks,
  parseProjectInfo,
  extractAppFields,
  extractVersionFields,
  extractProjectFields,
} from '../utils/typeGuards';

// 自定义文件接口，用于支持绝对路径
interface CustomFile {
  path: string;
  basename: string;
  extension: string;
  stat: {
    ctime: number;
    mtime: number;
  };
  readContent(): Promise<string>;
}

export class DataService {
  app: ObsidianApp;
  plugin: AppVersionManagerPlugin;
  public cache: DataCache;
  public readonly pathResolver: FilePathResolver;

  constructor(app: ObsidianApp, plugin: AppVersionManagerPlugin) {
    this.app = app;
    this.plugin = plugin;
    this.cache = new DataCache(30000, 1000);
    this.pathResolver = new FilePathResolver(() => this.plugin.settings.dataPath || 'workflow-hub');
  }

  /** Delegates to FilePathResolver for backward compatibility (used by main.ts). */
  public isAbsolutePath(): boolean {
    return this.pathResolver.isAbsolutePath();
  }

  /** 原地更新 projects:all 缓存，避免全量重读 */
  private updateProjectsAllCache(updater: (projects: Project[]) => Project[]): void {
    const cached = this.cache.get<Project[]>('projects:all');
    if (cached) {
      this.cache.set('projects:all', updater(cached));
    }
  }

  private async ensureFolder(path: string) {
    if (this.pathResolver.isAbsolutePath()) {
      // 使用文件系统API
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
      }
    } else {
      // 使用Obsidian vault API
      const folder = this.app.vault.getAbstractFileByPath(path);
      if (!folder) {
        await this.app.vault.createFolder(path);
      }
    }
  }

  private async writeFile(filePath: string, content: string) {
    if (this.pathResolver.isAbsolutePath()) {
      await fsPromises.writeFile(filePath, content, 'utf-8');
    } else {
      await this.app.vault.create(filePath, content);
    }
  }

  private async modifyFile(file: TFile | CustomFile, content: string) {
    if ('path' in file && this.pathResolver.isAbsolutePath()) {
      await fsPromises.writeFile(file.path, content, 'utf-8');
    } else if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    }
  }

  private async renameFile(file: TFile | CustomFile, newPath: string) {
    if ('path' in file && this.pathResolver.isAbsolutePath()) {
      await fsPromises.rename(file.path, newPath);
    } else if (file instanceof TFile) {
      await this.app.vault.rename(file, normalizePath(newPath));
    }
  }

  private async deleteFile(file: TFile | CustomFile) {
    if ('path' in file && this.pathResolver.isAbsolutePath()) {
      await fsPromises.unlink(file.path);
    } else if (file instanceof TFile) {
      await this.app.vault.delete(file);
    }
  }

  async initializeDataFolders() {
    await this.ensureFolder(this.pathResolver.getAppsFolder());
    await this.ensureFolder(this.pathResolver.getVersionsFolder());
    await this.ensureFolder(this.pathResolver.getProjectsFolder());
  }

  async getAllApps(): Promise<App[]> {
    const cacheKey = 'apps:all';
    const cached = this.cache.get<App[]>(cacheKey);
    if (cached) return cached;

    await this.initializeDataFolders();
    const apps: App[] = [];
    const files = await this.getMarkdownFiles(this.pathResolver.getAppsFolder());

    for (const file of files) {
      const app = await this.parseAppFile(file);
      if (app) apps.push(app);
    }

    const result = apps.sort((a, b) => a.name.localeCompare(b.name));
    this.cache.set(cacheKey, result);
    return result;
  }

  private async parseAppFile(file: TFile | CustomFile): Promise<App | null> {
    try {
      const ctime = file.stat.ctime;
      const mtime = file.stat.mtime;
      // Use vault.adapter.read to bypass Obsidian's cache (fixes plugin reload issue)
      const content = 'readContent' in file ? await file.readContent() : await this.app.vault.adapter.read(file.path);
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter) return null;
      return extractAppFields(frontmatter, file.basename, ctime, mtime);
    } catch (error) {
      console.error('[AppVersionManager] Failed to parse app file:', file.path, error);
      return null;
    }
  }

  private async getMarkdownFiles(folderPath: string): Promise<(TFile | CustomFile)[]> {
    if (this.pathResolver.isAbsolutePath()) {
      // 使用文件系统API
      try {
        if (!existsSync(folderPath)) return [];
        const items = readdirSync(folderPath);
        const files: CustomFile[] = [];

        for (const item of items) {
          const fullPath = join(folderPath, item);
          const stat = statSync(fullPath);
          if (stat.isFile() && extname(item).toLowerCase() === '.md') {
            files.push({
              path: fullPath,
              basename: basename(item, '.md'),
              extension: 'md',
              stat: {
                ctime: stat.ctime.getTime(),
                mtime: stat.mtime.getTime(),
              },
              readContent: () => fsPromises.readFile(fullPath, 'utf-8'),
            });
          }
        }
        return files;
      } catch (error) {
        console.error('Error reading directory:', folderPath, error);
        return [];
      }
    } else {
      // 使用Obsidian vault API
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (!(folder instanceof TFolder)) return [];
      return folder.children.filter((file): file is TFile => file instanceof TFile && file.extension === 'md');
    }
  }

  private async findEntityFileById<T extends { id: string }>(
    folderPath: string,
    parser: (file: TFile | CustomFile) => Promise<T | null>,
    id: string,
  ): Promise<TFile | CustomFile | null> {
    const files = await this.getMarkdownFiles(folderPath);
    // 快速路径：文件名格式为 {name}__{id}.md，通过文件名直接匹配 ID
    for (const file of files) {
      const fileName = 'name' in file ? file.name : `${file.basename}.${file.extension}`;
      const nameWithoutExt = fileName.replace(/\.md$/, '');
      const separatorIndex = nameWithoutExt.lastIndexOf('__');
      if (separatorIndex >= 0) {
        const idFromFile = nameWithoutExt.slice(separatorIndex + 2);
        if (idFromFile === id) {
          return file;
        }
      }
    }
    // 回退：全量解析（兼容旧格式文件）
    for (const file of files) {
      const entity = await parser.call(this, file);
      if (entity?.id === id) {
        return file;
      }
    }
    return null;
  }

  async createApp(name: string): Promise<App> {
    await this.initializeDataFolders();

    const apps = await this.getAllApps();
    if (apps.some((a) => a.name === name)) {
      throw new Error('APP name already exists');
    }

    const id = generateId();
    const now = nowISO();
    const app: App = { id, name, createdAt: now, updatedAt: now, version: 1 };

    const frontmatter = createFrontmatter({
      id: app.id,
      name: app.name,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
      version: app.version,
    });

    const fileName = sanitizeFileName(name);
    const filePath = this.pathResolver.joinPath(this.pathResolver.getAppsFolder(), `${fileName}__${id}.md`);

    await this.writeFile(filePath, frontmatter);
    this.cache.invalidate('apps:all');

    return app;
  }

  async updateApp(id: string, name: string, expectedVersion?: number): Promise<App | null> {
    const apps = await this.getAllApps();
    const app = apps.find((a) => a.id === id);
    if (!app) return null;

    if (expectedVersion !== undefined && app.version !== expectedVersion) {
      throw new ConcurrencyConflictError(`APP: ${app.name}`, app.version, expectedVersion);
    }

    if (apps.some((a) => a.name === name && a.id !== id)) {
      throw new Error('APP name already exists');
    }

    const oldName = app.name;
    app.name = name;
    app.updatedAt = nowISO();
    app.version = (app.version ?? 1) + 1;

    const oldFileName = sanitizeFileName(oldName);
    const newFileName = sanitizeFileName(name);

    let file: TFile | CustomFile | null = null;

    if (this.pathResolver.isAbsolutePath()) {
      // 对于绝对路径，我们需要手动查找文件
      const files = await this.getMarkdownFiles(this.pathResolver.getAppsFolder());
      for (const f of files) {
        const appData = await this.parseAppFile(f);
        if (appData?.id === id) {
          file = f;
          break;
        }
      }
    } else {
      // 对于相对路径，使用原来的逻辑
      const oldPath = normalizePath(`${this.pathResolver.getAppsFolder()}/${oldFileName}__${id}.md`);
      const legacyOldPath = normalizePath(`${this.pathResolver.getAppsFolder()}/${oldFileName}.md`);
      const fallbackFile =
        this.app.vault.getAbstractFileByPath(oldPath) ?? this.app.vault.getAbstractFileByPath(legacyOldPath);
      file =
        (await this.findEntityFileById<App>(this.pathResolver.getAppsFolder(), this.parseAppFile, id)) ??
        (fallbackFile instanceof TFile ? fallbackFile : null);
    }

    if (file) {
      const frontmatter = createFrontmatter({
        id: app.id,
        name: app.name,
        createdAt: app.createdAt,
        updatedAt: app.updatedAt,
        version: app.version,
      });

      await this.modifyFile(file, frontmatter);

      if (oldFileName !== newFileName) {
        const newPath = this.pathResolver.joinPath(this.pathResolver.getAppsFolder(), `${newFileName}__${app.id}.md`);
        await this.renameFile(file, newPath);
      }
    }

    this.cache.invalidate('apps:all');
    return app;
  }

  async deleteApp(id: string): Promise<boolean> {
    const apps = await this.getAllApps();
    const app = apps.find((a) => a.id === id);
    if (!app) return false;

    // 第一阶段：收集所有操作
    const versions = await this.getVersionsByAppId(id);
    const versionFiles: (TFile | CustomFile)[] = [];
    const versionIds: string[] = [];

    // 收集版本文件
    for (const version of versions) {
      const file = await this.findEntityFileById<Version>(
        this.pathResolver.getVersionsFolder(),
        this.parseVersionFile,
        version.id,
      );
      if (file) {
        versionFiles.push(file);
      }
      versionIds.push(version.id);
    }

    // 收集 App 文件
    const fileName = sanitizeFileName(app.name);
    let appFile: TFile | CustomFile | null = null;
    if (this.pathResolver.isAbsolutePath()) {
      const files = await this.getMarkdownFiles(this.pathResolver.getAppsFolder());
      for (const f of files) {
        const appData = await this.parseAppFile(f);
        if (appData?.id === id) {
          appFile = f;
          break;
        }
      }
    } else {
      const filePath = normalizePath(`${this.pathResolver.getAppsFolder()}/${fileName}__${id}.md`);
      const legacyFilePath = normalizePath(`${this.pathResolver.getAppsFolder()}/${fileName}.md`);
      const fallbackFile =
        this.app.vault.getAbstractFileByPath(filePath) ?? this.app.vault.getAbstractFileByPath(legacyFilePath);
      appFile =
        (await this.findEntityFileById<App>(this.pathResolver.getAppsFolder(), this.parseAppFile, id)) ??
        (fallbackFile instanceof TFile ? fallbackFile : null);
    }

    // 第二阶段：执行所有操作
    // 清理所有项目中引用了此 APP 或其版本的 appVersionLinks
    const allProjects = await this.getAllProjects();
    const versionIdSet = new Set(versionIds);
    for (const project of allProjects) {
      const cleaned = project.appVersionLinks.filter((link) => link.appId !== id && !versionIdSet.has(link.versionId));
      if (cleaned.length !== project.appVersionLinks.length) {
        await this.updateProject(project.id, { appVersionLinks: cleaned });
      }
    }

    // 删除所有版本文件
    for (const file of versionFiles) {
      await this.deleteFile(file);
    }

    // 删除 App 文件
    if (appFile) {
      await this.deleteFile(appFile);
    }

    this.cache.invalidate('apps:all');
    this.cache.invalidate('versions:all');
    this.cache.invalidate(`versions:${id}`);
    return true;
  }

  async getVersionsByAppId(appId: string): Promise<Version[]> {
    const cacheKey = `versions:${appId}`;
    const cached = this.cache.get<Version[]>(cacheKey);
    if (cached) return cached;

    await this.initializeDataFolders();
    const versions: Version[] = [];
    const files = await this.getMarkdownFiles(this.pathResolver.getVersionsFolder());

    for (const file of files) {
      const version = await this.parseVersionFile(file);
      if (version && version.appId === appId) {
        versions.push(version);
      }
    }

    const result = versions.sort((a, b) => compareVersions(b.versionNumber, a.versionNumber));
    this.cache.set(cacheKey, result);
    return result;
  }

  private async parseVersionFile(file: TFile | CustomFile): Promise<Version | null> {
    try {
      const ctime = file.stat.ctime;
      const mtime = file.stat.mtime;
      // Use vault.adapter.read to bypass Obsidian's cache (fixes plugin reload issue)
      const content = 'readContent' in file ? await file.readContent() : await this.app.vault.adapter.read(file.path);
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter) return null;
      return extractVersionFields(frontmatter, ctime, mtime);
    } catch (error) {
      console.error('[AppVersionManager] Failed to parse version file:', file.path, error);
      return null;
    }
  }

  async createVersion(data: {
    appId: string;
    versionNumber: string;
    bllVersion: string;
    ippVersion: string;
    webVersion: string;
    updateContent?: string;
  }): Promise<Version> {
    await this.initializeDataFolders();

    const existingVersions = await this.getVersionsByAppId(data.appId);
    if (existingVersions.some((v) => v.versionNumber === data.versionNumber)) {
      throw new Error('Version number already exists for this APP');
    }

    const id = generateId();
    const now = nowISO();
    const version: Version = {
      id,
      ...data,
      updateContent: data.updateContent || '',
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const frontmatter = createFrontmatter({
      id: version.id,
      appId: version.appId,
      versionNumber: version.versionNumber,
      bllVersion: version.bllVersion,
      ippVersion: version.ippVersion,
      webVersion: version.webVersion,
      updateContent: version.updateContent,
      isArchived: version.isArchived,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
      version: version.version,
    });

    const app = (await this.getAllApps()).find((a) => a.id === data.appId);
    const appName = app ? sanitizeFileName(app.name) : 'unknown';
    const versionNum = sanitizeFileName(data.versionNumber);
    const fileName = `${appName}_${versionNum}__${id}`;
    const filePath = this.pathResolver.joinPath(this.pathResolver.getVersionsFolder(), `${fileName}.md`);

    await this.writeFile(filePath, frontmatter);
    this.cache.invalidate(`versions:${data.appId}`);
    this.cache.invalidate('versions:all');

    return version;
  }

  async updateVersion(id: string, data: Partial<Version>, expectedVersion?: number): Promise<Version | null> {
    const allVersions = await this.getAllVersions();
    const version = allVersions.find((v) => v.id === id);
    if (!version) return null;

    if (expectedVersion !== undefined && version.version !== expectedVersion) {
      throw new ConcurrencyConflictError(`版本: ${version.versionNumber}`, version.version, expectedVersion);
    }

    if (data.versionNumber && data.versionNumber !== version.versionNumber) {
      const appVersions = await this.getVersionsByAppId(version.appId);
      if (appVersions.some((v) => v.versionNumber === data.versionNumber && v.id !== id)) {
        throw new Error('Version number already exists for this APP');
      }
    }

    Object.assign(version, data, { updatedAt: nowISO() });
    version.version = (version.version ?? 1) + 1;

    const app = (await this.getAllApps()).find((a) => a.id === version.appId);
    const appName = app ? sanitizeFileName(app.name) : 'unknown';
    const versionNum = sanitizeFileName(version.versionNumber);
    const fileName = `${appName}_${versionNum}__${version.id}`;
    const file = await this.findEntityFileById<Version>(
      this.pathResolver.getVersionsFolder(),
      this.parseVersionFile,
      id,
    );

    if (file) {
      const frontmatter = createFrontmatter({
        id: version.id,
        appId: version.appId,
        versionNumber: version.versionNumber,
        bllVersion: version.bllVersion,
        ippVersion: version.ippVersion,
        webVersion: version.webVersion,
        updateContent: version.updateContent,
        isArchived: version.isArchived,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
        version: version.version,
      });

      await this.modifyFile(file, frontmatter);

      if (file.basename !== fileName) {
        const newPath = this.pathResolver.joinPath(this.pathResolver.getVersionsFolder(), `${fileName}.md`);
        await this.renameFile(file, newPath);
      }
    }

    this.cache.invalidate(`versions:${version.appId}`);
    this.cache.invalidate('versions:all');
    return version;
  }

  async deleteVersion(id: string): Promise<boolean> {
    const allVersions = await this.getAllVersions();
    const version = allVersions.find((v) => v.id === id);
    if (!version) return false;

    const appId = version.appId;

    // 第一阶段：收集所有操作
    const file = await this.findEntityFileById<Version>(
      this.pathResolver.getVersionsFolder(),
      this.parseVersionFile,
      id,
    );

    // 清理所有项目中引用了此版本的 appVersionLinks
    const allProjects = await this.getAllProjects();
    for (const project of allProjects) {
      const cleaned = project.appVersionLinks.filter((link) => link.versionId !== id);
      if (cleaned.length !== project.appVersionLinks.length) {
        await this.updateProject(project.id, { appVersionLinks: cleaned });
      }
    }

    // 第二阶段：执行删除
    if (file) {
      await this.deleteFile(file);
    }

    this.cache.invalidate(`versions:${appId}`);
    this.cache.invalidate('versions:all');
    return true;
  }

  async getAllVersions(): Promise<Version[]> {
    const cacheKey = 'versions:all';
    const cached = this.cache.get<Version[]>(cacheKey);
    if (cached) return cached;

    await this.initializeDataFolders();
    const versions: Version[] = [];
    const files = await this.getMarkdownFiles(this.pathResolver.getVersionsFolder());

    for (const file of files) {
      const version = await this.parseVersionFile(file);
      if (version) versions.push(version);
    }

    this.cache.set(cacheKey, versions);
    return versions;
  }

  async archiveVersion(id: string, expectedVersion?: number): Promise<Version | null> {
    return this.updateVersion(id, { isArchived: true }, expectedVersion);
  }

  async unarchiveVersion(id: string, expectedVersion?: number): Promise<Version | null> {
    return this.updateVersion(id, { isArchived: false }, expectedVersion);
  }

  async getProjectsByVersionId(versionId: string): Promise<Project[]> {
    const allProjects = await this.getAllProjects();
    const filtered = allProjects.filter((p) => p.appVersionLinks.some((link) => link.versionId === versionId));
    const progressOrder = getProgressOrder(this.plugin.dataConfigService.config.progressStages);
    return filtered.sort((a, b) => progressOrder.indexOf(a.progress) - progressOrder.indexOf(b.progress));
  }

  /** 获取关联了指定 APP 的所有项目 */
  async getProjectsByAppId(appId: string): Promise<Project[]> {
    const allProjects = await this.getAllProjects();
    const filtered = allProjects.filter((p) => p.appVersionLinks.some((link) => link.appId === appId));
    const progressOrder = getProgressOrder(this.plugin.dataConfigService.config.progressStages);
    return filtered.sort((a, b) => progressOrder.indexOf(a.progress) - progressOrder.indexOf(b.progress));
  }

  private async parseProjectFile(file: TFile | CustomFile): Promise<Project | null> {
    try {
      const ctime = file.stat.ctime;
      const mtime = file.stat.mtime;
      // Use readContent for absolute path files (CustomFile), vault.adapter.read otherwise
      const content = 'readContent' in file ? await file.readContent() : await this.app.vault.adapter.read(file.path);
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter) return null;
      return extractProjectFields(frontmatter, ctime, mtime, getFirstProgress(this.plugin.dataConfigService.config.progressStages));
    } catch (error) {
      console.error('[AppVersionManager] Failed to parse project file:', file.path, error);
      return null;
    }
  }

  async createProject(data: {
    name: string;
    appVersionLinks?: ProjectLink[];
    manager?: string;
    responsiblePerson?: string;
    projectLink?: string;
    componentLink?: string;
    features?: string;
    spec?: string;
    requirements?: string;
    progress?: ProjectProgress;
    b1IntegrationTestTime?: string;
    b1SystemTestTime?: string;
    b2IntegrationTestTime?: string;
    b2SystemTestTime?: string;
    b3IntegrationTestTime?: string;
    b3SystemTestTime?: string;
    b4IntegrationTestTime?: string;
    b4SystemTestTime?: string;
    actualReleaseTime?: string;
  }): Promise<Project> {
    await this.initializeDataFolders();

    const existingProjects = await this.getAllProjects();
    if (existingProjects.some((p) => p.name === data.name)) {
      throw new Error('Project name already exists');
    }

    const id = generateId();
    const now = nowISO();
    const project: Project = {
      id,
      name: data.name,
      appVersionLinks: data.appVersionLinks || [],
      manager: data.manager || '',
      responsiblePerson: data.responsiblePerson || '',
      projectLink: data.projectLink || '',
      componentLink: data.componentLink || '',
      features: data.features || '',
      spec: data.spec || '',
      requirements: data.requirements || '',
      progress: data.progress || getFirstProgress(this.plugin.dataConfigService.config.progressStages),
      progressHistory: [
        {
          progress: data.progress || getFirstProgress(this.plugin.dataConfigService.config.progressStages),
          changedAt: now,
        },
      ],
      b1IntegrationTestTime: data.b1IntegrationTestTime || '',
      b1SystemTestTime: data.b1SystemTestTime || '',
      b2IntegrationTestTime: data.b2IntegrationTestTime || '',
      b2SystemTestTime: data.b2SystemTestTime || '',
      b3IntegrationTestTime: data.b3IntegrationTestTime || '',
      b3SystemTestTime: data.b3SystemTestTime || '',
      b4IntegrationTestTime: data.b4IntegrationTestTime || '',
      b4SystemTestTime: data.b4SystemTestTime || '',
      actualReleaseTime: data.actualReleaseTime || '',
      projectInfo: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const frontmatter = createFrontmatter({
      id: project.id,
      name: project.name,
      appVersionLinks: project.appVersionLinks,
      manager: project.manager,
      responsiblePerson: project.responsiblePerson,
      projectLink: project.projectLink,
      componentLink: project.componentLink,
      features: project.features,
      spec: project.spec,
      requirements: project.requirements,
      progress: project.progress,
      progressHistory: project.progressHistory.map((h) => `${h.progress}@${h.changedAt}`),
      b1IntegrationTestTime: project.b1IntegrationTestTime,
      b1SystemTestTime: project.b1SystemTestTime,
      b2IntegrationTestTime: project.b2IntegrationTestTime,
      b2SystemTestTime: project.b2SystemTestTime,
      b3IntegrationTestTime: project.b3IntegrationTestTime,
      b3SystemTestTime: project.b3SystemTestTime,
      b4IntegrationTestTime: project.b4IntegrationTestTime,
      b4SystemTestTime: project.b4SystemTestTime,
      actualReleaseTime: project.actualReleaseTime,
      projectInfo: project.projectInfo,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      version: project.version,
    });

    const fileName = sanitizeFileName(data.name);
    const projectFilePath = this.pathResolver.joinPath(this.pathResolver.getProjectsFolder(), `${fileName}__${id}.md`);

    await this.writeFile(projectFilePath, frontmatter);
    this.updateProjectsAllCache((projects) => [...projects, project]);
    this.cache.set(`project:${project.id}`, project);

    // Create default todos for the new project
    const defaultTodos = this.plugin.dataConfigService.config.defaultTodos;
    if (defaultTodos.length > 0) {
      for (const template of defaultTodos) {
        if (template.content.trim()) {
          await this.plugin.todoService.create({
            content: template.content.trim(),
            link: template.link?.trim() || undefined,
            dueDate: template.dueDate || undefined,
            projectId: project.id,
            categoryId: this.plugin.dataConfigService.config.defaultCategoryId,
          });
        }
      }
    }

    return project;
  }

  async updateProject(id: string, data: Partial<Project>, expectedVersion?: number): Promise<Project | null> {
    const allProjects = await this.getAllProjects();
    const project = allProjects.find((p) => p.id === id);
    if (!project) return null;

    if (expectedVersion !== undefined && project.version !== expectedVersion) {
      throw new ConcurrencyConflictError(`项目: ${project.name}`, project.version, expectedVersion);
    }

    if (data.name && data.name !== project.name) {
      if (allProjects.some((p) => p.name === data.name && p.id !== id)) {
        throw new Error('Project name already exists');
      }
    }

    const oldName = project.name;
    const progressChanged = data.progress && data.progress !== project.progress;

    const updatedProject = { ...project, ...data, updatedAt: nowISO() };
    updatedProject.version = (project.version ?? 1) + 1;

    if (progressChanged && data.progress) {
      updatedProject.progressHistory = [...project.progressHistory, { progress: data.progress, changedAt: nowISO() }];
    }

    const frontmatter = createFrontmatter({
      id: updatedProject.id,
      name: updatedProject.name,
      appVersionLinks: updatedProject.appVersionLinks,
      manager: updatedProject.manager,
      responsiblePerson: updatedProject.responsiblePerson,
      projectLink: updatedProject.projectLink,
      componentLink: updatedProject.componentLink,
      features: updatedProject.features,
      spec: updatedProject.spec,
      requirements: updatedProject.requirements,
      progress: updatedProject.progress,
      progressHistory: updatedProject.progressHistory.map((h) => `${h.progress}@${h.changedAt}`),
      b1IntegrationTestTime: updatedProject.b1IntegrationTestTime,
      b1SystemTestTime: updatedProject.b1SystemTestTime,
      b2IntegrationTestTime: updatedProject.b2IntegrationTestTime,
      b2SystemTestTime: updatedProject.b2SystemTestTime,
      b3IntegrationTestTime: updatedProject.b3IntegrationTestTime,
      b3SystemTestTime: updatedProject.b3SystemTestTime,
      b4IntegrationTestTime: updatedProject.b4IntegrationTestTime,
      b4SystemTestTime: updatedProject.b4SystemTestTime,
      actualReleaseTime: updatedProject.actualReleaseTime,
      // projectInfo 必须显式写入，否则保存后下次加载会丢失（返回空数组）
      projectInfo: updatedProject.projectInfo,
      createdAt: updatedProject.createdAt,
      updatedAt: updatedProject.updatedAt,
      version: updatedProject.version,
    });

    const oldFileName = sanitizeFileName(oldName);
    const newFileName = sanitizeFileName(updatedProject.name);

    let file: TFile | CustomFile | null = null;

    if (this.pathResolver.isAbsolutePath()) {
      // 对于绝对路径，我们需要手动查找文件
      const files = await this.getMarkdownFiles(this.pathResolver.getProjectsFolder());
      for (const f of files) {
        const projectData = await this.parseProjectFile(f);
        if (projectData?.id === id) {
          file = f;
          break;
        }
      }
    } else {
      // 对于相对路径，使用原来的逻辑
      const oldPath = normalizePath(`${this.pathResolver.getProjectsFolder()}/${oldFileName}.md`);
      const fallbackFile = this.app.vault.getAbstractFileByPath(oldPath);
      file =
        (await this.findEntityFileById<Project>(this.pathResolver.getProjectsFolder(), this.parseProjectFile, id)) ??
        (fallbackFile instanceof TFile ? fallbackFile : null);
    }

    if (file) {
      await this.modifyFile(file, frontmatter);

      if (oldFileName !== newFileName) {
        const newPath = this.pathResolver.joinPath(
          this.pathResolver.getProjectsFolder(),
          `${newFileName}__${project.id}.md`,
        );
        await this.renameFile(file, newPath);
      }
    }

    this.updateProjectsAllCache((projects) => projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)));
    this.cache.set(`project:${updatedProject.id}`, updatedProject);
    return updatedProject;
  }

  async deleteProject(id: string, expectedVersion?: number): Promise<boolean> {
    const allProjects = await this.getAllProjects();
    const project = allProjects.find((p) => p.id === id);
    if (!project) return false;
    if (expectedVersion !== undefined && project.version !== expectedVersion) {
      throw new ConcurrencyConflictError(`项目: ${project.name}`, project.version, expectedVersion);
    }

    const fileName = sanitizeFileName(project.name);
    let file: TFile | CustomFile | null = null;

    if (this.pathResolver.isAbsolutePath()) {
      // 对于绝对路径，我们需要手动查找文件
      const files = await this.getMarkdownFiles(this.pathResolver.getProjectsFolder());
      for (const f of files) {
        const projectData = await this.parseProjectFile(f);
        if (projectData?.id === id) {
          file = f;
          break;
        }
      }
    } else {
      const filePath = normalizePath(`${this.pathResolver.getProjectsFolder()}/${fileName}.md`);
      const fallbackFile = this.app.vault.getAbstractFileByPath(filePath);
      file =
        (await this.findEntityFileById<Project>(this.pathResolver.getProjectsFolder(), this.parseProjectFile, id)) ??
        (fallbackFile instanceof TFile ? fallbackFile : null);
    }

    if (file) {
      await this.deleteFile(file);
    }

    // Delete associated todos
    await this.plugin.todoService.deleteByProjectId(id);

    this.updateProjectsAllCache((projects) => projects.filter((p) => p.id !== id));
    this.cache.invalidate(`project:${id}`);
    return true;
  }

  async getAllProjects(): Promise<Project[]> {
    const cacheKey = 'projects:all';
    const cached = this.cache.get<Project[]>(cacheKey);
    if (cached) return cached;

    await this.initializeDataFolders();
    const projects: Project[] = [];
    const files = await this.getMarkdownFiles(this.pathResolver.getProjectsFolder());

    for (const file of files) {
      const project = await this.parseProjectFile(file);
      if (project) projects.push(project);
    }

    this.cache.set(cacheKey, projects);
    // 同时也缓存每个项目用于单实体查询
    for (const project of projects) {
      this.cache.set(`project:${project.id}`, project);
    }
    return projects;
  }

  async searchProjects(keyword: string): Promise<Project[]> {
    const allProjects = await this.getAllProjects();
    const lowerKeyword = keyword.toLowerCase();

    return allProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(lowerKeyword) ||
        p.manager.toLowerCase().includes(lowerKeyword) ||
        p.responsiblePerson.toLowerCase().includes(lowerKeyword) ||
        p.requirements.toLowerCase().includes(lowerKeyword),
    );
  }

  async getProjectById(id: string): Promise<Project | null> {
    const cached = this.cache.get<Project>(`project:${id}`);
    if (cached) return cached;
    const allProjects = await this.getAllProjects();
    return allProjects.find((p) => p.id === id) || null;
  }

  async getVersionById(id: string): Promise<Version | null> {
    const allVersions = await this.getAllVersions();
    return allVersions.find((v) => v.id === id) || null;
  }

  async getAppById(id: string): Promise<App | null> {
    const allApps = await this.getAllApps();
    return allApps.find((a) => a.id === id) || null;
  }

  async upsertAppRecord(record: App): Promise<void> {
    await this.initializeDataFolders();
    const fileName = sanitizeFileName(record.name);
    const targetPath = this.pathResolver.joinPath(this.pathResolver.getAppsFolder(), `${fileName}__${record.id}.md`);
    const frontmatter = createFrontmatter(record as unknown as Record<string, unknown>);
    const existingFile = await this.findEntityFileById<App>(
      this.pathResolver.getAppsFolder(),
      this.parseAppFile,
      record.id,
    );
    if (existingFile) {
      await this.modifyFile(existingFile, frontmatter);
      if (existingFile.path !== targetPath) {
        await this.renameFile(existingFile, targetPath);
      }
      return;
    }
    await this.writeFile(targetPath, frontmatter);
  }

  async upsertVersionRecord(record: Version): Promise<void> {
    await this.initializeDataFolders();
    const app = await this.getAppById(record.appId);
    const appName = sanitizeFileName(app?.name || 'unknown');
    const versionName = sanitizeFileName(record.versionNumber);
    const targetPath = this.pathResolver.joinPath(
      this.pathResolver.getVersionsFolder(),
      `${appName}_${versionName}__${record.id}.md`,
    );
    const frontmatter = createFrontmatter(record as unknown as Record<string, unknown>);
    const existingFile = await this.findEntityFileById<Version>(
      this.pathResolver.getVersionsFolder(),
      this.parseVersionFile,
      record.id,
    );
    if (existingFile) {
      await this.modifyFile(existingFile, frontmatter);
      if (existingFile.path !== targetPath) {
        await this.renameFile(existingFile, targetPath);
      }
      return;
    }
    await this.writeFile(targetPath, frontmatter);
  }

  async upsertProjectRecord(record: Project): Promise<void> {
    await this.initializeDataFolders();
    const fileName = sanitizeFileName(record.name);
    const targetPath = this.pathResolver.joinPath(
      this.pathResolver.getProjectsFolder(),
      `${fileName}__${record.id}.md`,
    );
    const frontmatter = createFrontmatter({
      ...record,
      responsiblePerson: record.responsiblePerson || '',
      progressHistory: record.progressHistory.map((h) => `${h.progress}@${h.changedAt}`),
      appVersionLinks: record.appVersionLinks || [],
    } as Record<string, unknown>);
    const existingFile = await this.findEntityFileById<Project>(
      this.pathResolver.getProjectsFolder(),
      this.parseProjectFile,
      record.id,
    );
    if (existingFile) {
      await this.modifyFile(existingFile, frontmatter);
      if (existingFile.path !== targetPath) {
        await this.renameFile(existingFile, targetPath);
      }
    } else {
      await this.writeFile(targetPath, frontmatter);
    }
  }
}
