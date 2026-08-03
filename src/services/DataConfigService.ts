import { join } from 'path';
import { normalizePath } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import { DataConfig, DEFAULT_DATA_CONFIG, ProgressStage, DefaultTodoTemplate } from '../types';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from '../utils/fsUtils';

/**
 * 数据目录配置服务。
 * 管理跟着数据存储路径走的配置，存储在 {dataPath}/.workflow-hub-config.json。
 * 
 * 这些配置是数据集本身的属性：
 * - 流程阶段定义
 * - 预发布轮次
 * - 负责人列表
 * - 默认待办模板
 * - 默认分类
 * - 默认 APP
 * - 表格列配置
 */
export class DataConfigService {
  private plugin: AppVersionManagerPlugin;
  config: DataConfig = { ...DEFAULT_DATA_CONFIG };
  private loaded = false;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(plugin: AppVersionManagerPlugin) {
    this.plugin = plugin;
  }

  /** 配置文件名 */
  private static readonly CONFIG_FILE = '.workflow-hub-config.json';

  /** 获取配置文件路径 */
  private getConfigPath(): string {
    const dataPath = this.plugin.settings.dataPath || 'workflow-hub';
    const resolver = this.plugin.dataService.pathResolver;
    return resolver.isAbsolutePath()
      ? resolver.joinPath(dataPath, DataConfigService.CONFIG_FILE)
      : normalizePath(`${dataPath}/${DataConfigService.CONFIG_FILE}`);
  }

  /** 加载配置（幂等，已加载则跳过） */
  async load(): Promise<void> {
    if (this.loaded) return;
    const configPath = this.getConfigPath();

    let configFileFound: boolean;
    if (this.plugin.dataService.pathResolver.isAbsolutePath()) {
      configFileFound = this.loadFromAbsolute(configPath);
    } else {
      configFileFound = await this.loadFromVault(configPath);
    }

    // 配置文件不存在时，尝试从旧版插件设置（v1.0 前存于 plugin data）迁移
    if (!configFileFound) {
      await this.migrateLegacyConfig();
    }

    this.loaded = true;
  }

  private loadFromAbsolute(configPath: string): boolean {
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.config = this.mergeConfig(parsed);
        return true;
      } catch (e) {
        console.error('[WorkflowHub] 数据配置文件解析失败，使用默认配置:', e);
        this.config = { ...DEFAULT_DATA_CONFIG };
        return false;
      }
    }
    this.config = { ...DEFAULT_DATA_CONFIG };
    return false;
  }

  private async loadFromVault(configPath: string): Promise<boolean> {
    try {
      // 配置文件是 dotfile（.workflow-hub-config.json），Obsidian 的 vault 索引
      // 不保证包含隐藏文件（getAbstractFileByPath 可能返回 null），必须用 adapter
      // 直接读写磁盘，否则加载会静默失败回退到默认配置
      const adapter = this.plugin.app.vault.adapter;
      if (await adapter.exists(configPath)) {
        const content = await adapter.read(configPath);
        const parsed = JSON.parse(content);
        this.config = this.mergeConfig(parsed);
        return true;
      }
      this.config = { ...DEFAULT_DATA_CONFIG };
      return false;
    } catch (e) {
      console.error('[WorkflowHub] 数据配置文件解析失败，使用默认配置:', e);
      this.config = { ...DEFAULT_DATA_CONFIG };
      return false;
    }
  }

  /** 旧版本（配置存放在 plugin data 的 settings 中）迁移。仅在配置文件不存在时执行；迁移后从 plugin data 清理旧字段避免重复迁移。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async migrateLegacyConfig(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: Record<string, any> = (await this.plugin.loadData()) || {};
      const LEGACY_KEYS = [
        'progressStages',
        'responsiblePersons',
        'defaultTodos',
        'tableColumns',
        'preReleaseRound',
        'defaultCategoryId',
        'defaultAppId',
      ];
      if (!LEGACY_KEYS.some((k) => data[k] !== undefined)) return;

      const legacy: Partial<DataConfig> = {};
      if (Array.isArray(data.progressStages) && data.progressStages.length > 0) {
        legacy.progressStages = data.progressStages as ProgressStage[];
      }
      if (Array.isArray(data.responsiblePersons)) {
        legacy.responsiblePersons = data.responsiblePersons as string[];
      }
      if (Array.isArray(data.defaultTodos)) {
        legacy.defaultTodos = data.defaultTodos as DefaultTodoTemplate[];
      }
      if (Array.isArray(data.tableColumns) && data.tableColumns.length > 0) {
        legacy.tableColumns = data.tableColumns as string[];
      }
      if (typeof data.preReleaseRound === 'string' && data.preReleaseRound) {
        legacy.preReleaseRound = data.preReleaseRound;
      }
      if (data.defaultCategoryId === null || typeof data.defaultCategoryId === 'string') {
        legacy.defaultCategoryId = data.defaultCategoryId as string | null;
      }
      if (data.defaultAppId === null || typeof data.defaultAppId === 'string') {
        legacy.defaultAppId = data.defaultAppId as string | null;
      }

      this.config = this.mergeConfig(legacy);
      await this.save();
      console.log('[WorkflowHub] 已从旧版插件设置迁移数据配置');

      // 清理 plugin data 中的旧字段，避免每次启动重复迁移
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        if (!LEGACY_KEYS.includes(k)) clean[k] = v;
      }
      await this.plugin.saveData(clean);
    } catch (e) {
      console.error('[WorkflowHub] 旧版配置迁移失败:', e);
    }
  }

  /** 合并配置，确保新增字段有默认值 */
  private mergeConfig(parsed: Partial<DataConfig>): DataConfig {
    return {
      defaultAppId: parsed.defaultAppId ?? DEFAULT_DATA_CONFIG.defaultAppId,
      progressStages: Array.isArray(parsed.progressStages) && parsed.progressStages.length > 0
        ? parsed.progressStages
        : DEFAULT_DATA_CONFIG.progressStages,
      preReleaseRound: parsed.preReleaseRound ?? DEFAULT_DATA_CONFIG.preReleaseRound,
      defaultTodos: Array.isArray(parsed.defaultTodos) ? parsed.defaultTodos : [],
      responsiblePersons: Array.isArray(parsed.responsiblePersons) ? parsed.responsiblePersons : [],
      defaultCategoryId: parsed.defaultCategoryId ?? DEFAULT_DATA_CONFIG.defaultCategoryId,
      tableColumns: Array.isArray(parsed.tableColumns) && parsed.tableColumns.length > 0
        ? parsed.tableColumns
        : DEFAULT_DATA_CONFIG.tableColumns,
    };
  }

  /** 获取当前配置（只读） */
  getConfig(): Readonly<DataConfig> {
    return this.config;
  }

  /** 更新配置并持久化 */
  async update(updater: (config: DataConfig) => void): Promise<void> {
    updater(this.config);
    await this.save();
  }

  /** 手动设置配置（用于导入/恢复） */
  setConfig(config: DataConfig): void {
    this.config = { ...config };
  }

  /** 保存配置到磁盘（队列化写入，避免并发冲突） */
  async save(): Promise<void> {
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(async () => {
        const configPath = this.getConfigPath();
        const json = JSON.stringify(this.config, null, 2);

        if (this.plugin.dataService.pathResolver.isAbsolutePath()) {
          this.ensureDirAbsolute(configPath);
          writeFileSync(configPath, json, 'utf-8');
        } else {
          await this.saveToVault(configPath, json);
        }
      });
    await this.saveQueue;
  }

  private ensureDirAbsolute(configPath: string): void {
    const dir = join(configPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private async saveToVault(configPath: string, json: string): Promise<void> {
    // 配置文件是 dotfile：getAbstractFileByPath 可能返回 null（Obsidian 不索引隐藏文件），
    // vault.create 对已存在文件会抛 "File already exists" —— 必须用 adapter 直接写磁盘
    const adapter = this.plugin.app.vault.adapter;
    // 确保父目录存在
    const parentPath = normalizePath(configPath.split('/').slice(0, -1).join('/'));
    if (parentPath && !(await adapter.exists(parentPath))) {
      await this.plugin.app.vault.createFolder(parentPath).catch(() => {});
    }
    await adapter.write(configPath, json);
  }

  /** 切换数据路径时重置加载状态 */
  reset(): void {
    this.loaded = false;
    this.config = { ...DEFAULT_DATA_CONFIG };
  }

  // ---- 便捷 getter ----

  getDefaultAppId(): string | null {
    return this.config.defaultAppId;
  }

  getProgressStages(): ProgressStage[] {
    return this.config.progressStages;
  }

  getPreReleaseRound(): string {
    return this.config.preReleaseRound;
  }

  getDefaultTodos(): DefaultTodoTemplate[] {
    return this.config.defaultTodos;
  }

  getResponsiblePersons(): string[] {
    return this.config.responsiblePersons;
  }

  getDefaultCategoryId(): string | null {
    return this.config.defaultCategoryId;
  }

  getTableColumns(): string[] {
    return this.config.tableColumns;
  }
}
