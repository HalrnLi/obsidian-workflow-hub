import { App as ObsidianApp, TFile, TFolder, normalizePath } from 'obsidian';
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, unlinkSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { join, isAbsolute, basename, extname } from 'path';
import AppVersionManagerPlugin from '../main';
import {
  App,
  Version,
  Project,
  ProjectProgress,
  ProgressHistoryItem,
  ProjectInfoItem,
  ConcurrencyConflictError,
  getProgressOrder,
  getFirstProgress,
} from '../types';
import { DataCache } from '../utils/DataCache';
import { parseFrontmatter, createFrontmatter, parseNumericField, parseProgressHistory } from '../utils/frontmatter';
import { generateId, sanitizeFileName, compareVersions } from '../utils/idUtils';
import { nowISO } from '../utils/dateUtils';

// 解析 projectInfo 数组（frontmatter 已解析为对象数组，这里做字段规范化与空条目过滤）
function parseProjectInfo(raw: unknown): ProjectInfoItem[] {
  if (!Array.isArray(raw)) return [];
  const result: ProjectInfoItem[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const description = (item as any).description;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const link = (item as any).link;
      if (typeof description === 'string' && description.trim()) {
        result.push({ description, link: typeof link === 'string' ? link : '' });
      }
    }
  }
  return result;
}

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
  private cache: DataCache;

  constructor(app: ObsidianApp, plugin: AppVersionManagerPlugin) {
    this.app = app;
    this.plugin = plugin;
    this.cache = new DataCache(30000);
  }

  /** 原地更新 projects:all 缓存，避免全量重读 */
  private updateProjectsAllCache(updater: (projects: Project[]) => Project[]): void {
    const cached = this.cache.get<Project[]>('projects:all');
    if (cached) {
      this.cache.set('projects:all', updater(cached));
    }
  }

  private getDataPath(): string {
    return this.plugin.settings.dataPath || 'app-version-manager';
  }

  public isAbsolutePath(): boolean {
    const path = this.getDataPath();
    return isAbsolute(path) || /^[A-Za-z]:/.test(path); // Windows drive letter or absolute path
  }

  /** 统一路径拼接：仅相对路径进行 normalize，绝对路径保持 path.join 原生结果 */
  private joinPath(...parts: string[]): string {
    const joined = join(...parts);
    // 绝对路径（含 UNC 如 \\server\share）不经过 normalizePath，
    // 因为 normalizePath 会将 \\ → / 并折叠 //，破坏 Windows UNC 前缀
    return isAbsolute(joined) ? joined : normalizePath(joined);
  }

  private getAppsFolder(): string {
    return this.joinPath(this.getDataPath(), 'apps');
  }

  private getVersionsFolder(): string {
    return this.joinPath(this.getDataPath(), 'versions');
  }

  private getProjectsFolder(): string {
    return this.joinPath(this.getDataPath(), 'projects');
  }


  private async ensureFolder(path: string) {
    if (this.isAbsolutePath()) {
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
    if (this.isAbsolutePath()) {
      await fsPromises.writeFile(filePath, content, 'utf-8');
    } else {
      await this.app.vault.create(filePath, content);
    }
  }

  private async modifyFile(file: TFile | CustomFile, content: string) {
    if ('path' in file && this.isAbsolutePath()) {
      await fsPromises.writeFile(file.path, content, 'utf-8');
    } else if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    }
  }

  private async renameFile(file: TFile | CustomFile, newPath: string) {
    if ('path' in file && this.isAbsolutePath()) {
      const newFullPath = this.isAbsolutePath() ? newPath : normalizePath(newPath);
      await fsPromises.rename(file.path, newFullPath);
    } else if (file instanceof TFile) {
      await this.app.vault.rename(file, normalizePath(newPath));
    }
  }

  private async deleteFile(file: TFile | CustomFile) {
    if ('path' in file && this.isAbsolutePath()) {
      await fsPromises.unlink(file.path);
    } else if (file instanceof TFile) {
      await this.app.vault.delete(file);
    }
  }

  async initializeDataFolders() {
    await this.ensureFolder(this.getAppsFolder());
    await this.ensureFolder(this.getVersionsFolder());
    await this.ensureFolder(this.getProjectsFolder());
  }

  async getAllApps(): Promise<App[]> {
    const cacheKey = 'apps:all';
    const cached = this.cache.get<App[]>(cacheKey);
    if (cached) return cached;

    await this.initializeDataFolders();
    const apps: App[] = [];
    const files = await this.getMarkdownFiles(this.getAppsFolder());

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
      let content: string;
      const ctime = file.stat.ctime;
      const mtime = file.stat.mtime;

      if ('readContent' in file) {
        content = await file.readContent();
      } else {
        content = await this.app.vault.read(file);
      }

      const frontmatter = parseFrontmatter(content);
      if (!frontmatter) return null;

      return {
        id: frontmatter.id ?? file.basename,
        name: String(frontmatter.name ?? file.basename ?? ''),
        createdAt: frontmatter.createdAt ?? ctime.toString(),
        updatedAt: frontmatter.updatedAt ?? mtime.toString(),
        version: parseNumericField(frontmatter.version, 1),
      };
    } catch (error) {
      console.error('[AppVersionManager] Failed to parse app file:', file.path, error);
      return null;
    }
  }


  private async getMarkdownFiles(folderPath: string): Promise<(TFile | CustomFile)[]> {
    if (this.isAbsolutePath()) {
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
    const filePath = this.joinPath(this.getAppsFolder(), `${fileName}__${id}.md`);

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

    if (this.isAbsolutePath()) {
      // 对于绝对路径，我们需要手动查找文件
      const files = await this.getMarkdownFiles(this.getAppsFolder());
      for (const f of files) {
        const appData = await this.parseAppFile(f);
        if (appData?.id === id) {
          file = f;
          break;
        }
      }
    } else {
      // 对于相对路径，使用原来的逻辑
      const oldPath = normalizePath(`${this.getAppsFolder()}/${oldFileName}__${id}.md`);
      const legacyOldPath = normalizePath(`${this.getAppsFolder()}/${oldFileName}.md`);
      const fallbackFile = this.app.vault.getAbstractFileByPath(oldPath) ?? this.app.vault.getAbstractFileByPath(legacyOldPath);
      file =
        (await this.findEntityFileById<App>(this.getAppsFolder(), this.parseAppFile, id)) ??
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
        const newPath = this.joinPath(this.getAppsFolder(), `${newFileName}__${app.id}.md`);
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

    // 第一阶段：收集所有操作，验证它们都能执行
    const versions = await this.getVersionsByAppId(id);
    const versionFiles: (TFile | CustomFile)[] = [];
    const versionProjectUpdates: { projectId: string; versionId: string }[] = [];

    // 收集版本文件和需要更新的项目
    for (const version of versions) {
      const file = await this.findEntityFileById<Version>(this.getVersionsFolder(), this.parseVersionFile, version.id);
      if (file) {
        versionFiles.push(file);
      }
      const projects = await this.getProjectsByVersionId(version.id);
      for (const project of projects) {
        versionProjectUpdates.push({ projectId: project.id, versionId: '' });
      }
    }

    // 收集 App 文件
    const fileName = sanitizeFileName(app.name);
    let appFile: TFile | CustomFile | null = null;
    if (this.isAbsolutePath()) {
      const files = await this.getMarkdownFiles(this.getAppsFolder());
      for (const f of files) {
        const appData = await this.parseAppFile(f);
        if (appData?.id === id) {
          appFile = f;
          break;
        }
      }
    } else {
      const filePath = normalizePath(`${this.getAppsFolder()}/${fileName}__${id}.md`);
      const legacyFilePath = normalizePath(`${this.getAppsFolder()}/${fileName}.md`);
      const fallbackFile = this.app.vault.getAbstractFileByPath(filePath) ?? this.app.vault.getAbstractFileByPath(legacyFilePath);
      appFile =
        (await this.findEntityFileById<App>(this.getAppsFolder(), this.parseAppFile, id)) ??
        (fallbackFile instanceof TFile ? fallbackFile : null);
    }

    // 第二阶段：执行所有操作（原子性：如果任何操作失败，已执行的操作不会回滚，但会抛出错误）
    // 清空所有关联项目的 versionId
    for (const update of versionProjectUpdates) {
      await this.updateProject(update.projectId, { versionId: update.versionId });
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
    return true;
  }

  async getVersionsByAppId(appId: string): Promise<Version[]> {
    const cacheKey = `versions:${appId}`;
    const cached = this.cache.get<Version[]>(cacheKey);
    if (cached) return cached;

    await this.initializeDataFolders();
    const versions: Version[] = [];
    const files = await this.getMarkdownFiles(this.getVersionsFolder());

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
      let content: string;
      const ctime = file.stat.ctime;
      const mtime = file.stat.mtime;

      if ('readContent' in file) {
        content = await file.readContent();
      } else {
        content = await this.app.vault.read(file);
      }

      const frontmatter = parseFrontmatter(content);
      if (!frontmatter || !frontmatter.appId) return null;

      return {
        id: frontmatter.id ?? file.basename,
        appId: frontmatter.appId,
        versionNumber: frontmatter.versionNumber ?? '',
        bllVersion: frontmatter.bllVersion ?? '',
        ippVersion: frontmatter.ippVersion ?? '',
        webVersion: frontmatter.webVersion ?? '',
        updateContent: frontmatter.updateContent ?? '',
        isArchived: frontmatter.isArchived === true,
        createdAt: frontmatter.createdAt ?? ctime.toString(),
        updatedAt: frontmatter.updatedAt ?? mtime.toString(),
        version: parseNumericField(frontmatter.version, 1),
      };
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
    const filePath = this.joinPath(this.getVersionsFolder(), `${fileName}.md`);

    await this.writeFile(filePath, frontmatter);
    this.cache.invalidate(`versions:${data.appId}`);

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
    const file = await this.findEntityFileById<Version>(this.getVersionsFolder(), this.parseVersionFile, id);

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
        const newPath = this.joinPath(this.getVersionsFolder(), `${fileName}.md`);
        await this.renameFile(file, newPath);
      }
    }

    this.cache.invalidate(`versions:${version.appId}`);
    return version;
  }

  async deleteVersion(id: string): Promise<boolean> {
    const allVersions = await this.getAllVersions();
    const version = allVersions.find((v) => v.id === id);
    if (!version) return false;

    const appId = version.appId;

    // 第一阶段：收集所有操作
    const projects = await this.getProjectsByVersionId(id);
    const projectUpdates: { projectId: string; versionId: string }[] = projects.map((p) => ({ projectId: p.id, versionId: '' }));

    const file = await this.findEntityFileById<Version>(this.getVersionsFolder(), this.parseVersionFile, id);

    // 第二阶段：执行所有操作
    for (const update of projectUpdates) {
      await this.updateProject(update.projectId, { versionId: update.versionId });
    }

    if (file) {
      await this.deleteFile(file);
    }

    this.cache.invalidate(`versions:${appId}`);
    return true;
  }

  async getAllVersions(): Promise<Version[]> {
    const cacheKey = 'versions:all';
    const cached = this.cache.get<Version[]>(cacheKey);
    if (cached) return cached;

    await this.initializeDataFolders();
    const versions: Version[] = [];
    const files = await this.getMarkdownFiles(this.getVersionsFolder());

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
    const filtered = allProjects.filter((p) => p.versionId === versionId);
    const progressOrder = getProgressOrder(this.plugin.settings.progressStages);
    return filtered.sort((a, b) => progressOrder.indexOf(a.progress) - progressOrder.indexOf(b.progress));
  }

  private async parseProjectFile(file: TFile | CustomFile): Promise<Project | null> {
    try {
      let content: string;
      const ctime = file.stat.ctime;
      const mtime = file.stat.mtime;

      if ('readContent' in file) {
        content = await file.readContent();
      } else {
        content = await this.app.vault.read(file);
      }

      const frontmatter = parseFrontmatter(content);
      if (!frontmatter) return null;

      return {
        id: frontmatter.id ?? file.basename,
        name: String(frontmatter.name ?? ''),
        versionId: frontmatter.versionId ?? '',
        manager: frontmatter.manager ?? '',
        responsiblePerson: frontmatter.responsiblePerson ?? '',
        projectLink: frontmatter.projectLink ?? '',
        componentLink: frontmatter.componentLink ?? '',
        features: frontmatter.features ?? '',
        spec: frontmatter.spec ?? '',
        requirements: frontmatter.requirements ?? '',
        progress: frontmatter.progress ?? getFirstProgress(this.plugin.settings.progressStages),
        progressHistory: parseProgressHistory(frontmatter.progressHistory),
        b1IntegrationTestTime: frontmatter.b1IntegrationTestTime ?? '',
        b1SystemTestTime: frontmatter.b1SystemTestTime ?? '',
        b2IntegrationTestTime: frontmatter.b2IntegrationTestTime ?? '',
        b2SystemTestTime: frontmatter.b2SystemTestTime ?? '',
        b3IntegrationTestTime: frontmatter.b3IntegrationTestTime ?? '',
        b3SystemTestTime: frontmatter.b3SystemTestTime ?? '',
        b4IntegrationTestTime: frontmatter.b4IntegrationTestTime ?? '',
        b4SystemTestTime: frontmatter.b4SystemTestTime ?? '',
        actualReleaseTime: frontmatter.actualReleaseTime ?? '',
        projectInfo: parseProjectInfo(frontmatter.projectInfo),
        createdAt: frontmatter.createdAt ?? ctime.toString(),
        updatedAt: frontmatter.updatedAt ?? mtime.toString(),
        version: parseNumericField(frontmatter.version, 1),
      };
    } catch (error) {
      console.error('[AppVersionManager] Failed to parse project file:', file.path, error);
      return null;
    }
  }

  async createProject(data: {
    name: string;
    versionId: string;
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
      versionId: data.versionId,
      manager: data.manager || '',
      responsiblePerson: data.responsiblePerson || '',
      projectLink: data.projectLink || '',
      componentLink: data.componentLink || '',
      features: data.features || '',
      spec: data.spec || '',
      requirements: data.requirements || '',
      progress: data.progress || getFirstProgress(this.plugin.settings.progressStages),
      progressHistory: [
        {
          progress: data.progress || getFirstProgress(this.plugin.settings.progressStages),
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
      versionId: project.versionId,
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
    const projectFilePath = this.joinPath(this.getProjectsFolder(), `${fileName}__${id}.md`);

    await this.writeFile(projectFilePath, frontmatter);
    this.updateProjectsAllCache((projects) => [...projects, project]);
    this.cache.set(`project:${project.id}`, project);

    // Create default todos for the new project
    const defaultTodos = this.plugin.settings.defaultTodos;
    if (defaultTodos.length > 0) {
      for (const template of defaultTodos) {
        if (template.content.trim()) {
          await this.plugin.todoService.create({
            content: template.content.trim(),
            link: template.link?.trim() || undefined,
            dueDate: template.dueDate || undefined,
            projectId: project.id,
            categoryId: this.plugin.settings.defaultCategoryId,
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
      versionId: updatedProject.versionId,
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

    if (this.isAbsolutePath()) {
      // 对于绝对路径，我们需要手动查找文件
      const files = await this.getMarkdownFiles(this.getProjectsFolder());
      for (const f of files) {
        const projectData = await this.parseProjectFile(f);
        if (projectData?.id === id) {
          file = f;
          break;
        }
      }
    } else {
      // 对于相对路径，使用原来的逻辑
      const oldPath = normalizePath(`${this.getProjectsFolder()}/${oldFileName}.md`);
      const fallbackFile = this.app.vault.getAbstractFileByPath(oldPath);
      file =
        (await this.findEntityFileById<Project>(this.getProjectsFolder(), this.parseProjectFile, id)) ??
        (fallbackFile instanceof TFile ? fallbackFile : null);
    }

    if (file) {
      await this.modifyFile(file, frontmatter);

      if (oldFileName !== newFileName) {
        const newPath = this.joinPath(this.getProjectsFolder(), `${newFileName}__${project.id}.md`);
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

    if (this.isAbsolutePath()) {
      // 对于绝对路径，我们需要手动查找文件
      const files = await this.getMarkdownFiles(this.getProjectsFolder());
      for (const f of files) {
        const projectData = await this.parseProjectFile(f);
        if (projectData?.id === id) {
          file = f;
          break;
        }
      }
    } else {
      const filePath = normalizePath(`${this.getProjectsFolder()}/${fileName}.md`);
      const fallbackFile = this.app.vault.getAbstractFileByPath(filePath);
      file =
        (await this.findEntityFileById<Project>(this.getProjectsFolder(), this.parseProjectFile, id)) ??
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
    const files = await this.getMarkdownFiles(this.getProjectsFolder());

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
    const targetPath = this.joinPath(this.getAppsFolder(), `${fileName}__${record.id}.md`);
    const frontmatter = createFrontmatter(record as unknown as Record<string, unknown>);
    const existingFile = await this.findEntityFileById<App>(this.getAppsFolder(), this.parseAppFile, record.id);
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
    const targetPath = this.joinPath(this.getVersionsFolder(), `${appName}_${versionName}__${record.id}.md`);
    const frontmatter = createFrontmatter(record as unknown as Record<string, unknown>);
    const existingFile = await this.findEntityFileById<Version>(this.getVersionsFolder(), this.parseVersionFile, record.id);
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
    const targetPath = this.joinPath(this.getProjectsFolder(), `${fileName}__${record.id}.md`);
    const frontmatter = createFrontmatter({
      ...record,
      responsiblePerson: record.responsiblePerson || '',
      progressHistory: record.progressHistory.map((h) => `${h.progress}@${h.changedAt}`),
    } as Record<string, unknown>);
    const existingFile = await this.findEntityFileById<Project>(this.getProjectsFolder(), this.parseProjectFile, record.id);
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
