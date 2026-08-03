import { describe, it, expect, beforeEach, vi } from 'vitest';

// Break circular dependency: DataConfigService -> main -> DataConfigService
vi.mock('../../src/main', () => ({
  default: class {},
}));

// Mock the fsUtils module (absolute path mode uses these functions)
vi.mock('../../src/utils/fsUtils', () => {
  const mod = {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
  return { ...mod, default: mod };
});
vi.mock('path', () => {
  const mod = {
    join: (...args: string[]) => args.join('/'),
  };
  return { ...mod, default: mod };
});

import { existsSync, readFileSync, writeFileSync, mkdirSync } from '../../src/utils/fsUtils';
import { App, Vault, TFile } from 'obsidian';
import { DataConfigService } from '../../src/services/DataConfigService';

function createMockPlugin(overrides: Record<string, unknown> = {}) {
  const app = new App();
  const vault = new Vault();
  Object.assign(vault, {
    getAbstractFileByPath: vi.fn(() => null),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => {}),
    modify: vi.fn(async () => {}),
  });
  app.vault = vault;

  const plugin = {
    app,
    settings: { dataPath: 'workflow-hub' },
    dataService: {
      pathResolver: {
        isAbsolutePath: () => false,
        joinPath: (...parts: string[]) => parts.join('/'),
      },
    },
    loadData: vi.fn(async () => ({})),
    saveData: vi.fn(async () => {}),
    ...overrides,
  };
  return { plugin, vault };
}

function createMockPluginAbsolute(overrides: Record<string, unknown> = {}) {
  return createMockPlugin({
    dataService: {
      pathResolver: {
        isAbsolutePath: () => true,
        joinPath: (...parts: string[]) => parts.join('/'),
      },
    },
    ...overrides,
  });
}

describe('DataConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('加载默认配置：无配置文件且无旧版设置', async () => {
    const { plugin } = createMockPlugin();
    const svc = new DataConfigService(plugin as any);
    await svc.load();

    expect(svc.config.progressStages).toHaveLength(7);
    expect(svc.config.responsiblePersons).toEqual([]);
    expect(svc.config.tableColumns).toContain('name');
    // 无旧配置时不触发迁移与写入
    expect(plugin.saveData).not.toHaveBeenCalled();
  });

  it('从旧版 plugin data 迁移配置并清理旧字段', async () => {
    const legacy = {
      progressStages: [{ name: '自定义阶段', color: '#ff0000' }],
      responsiblePersons: ['张三', '李四'],
      defaultTodos: [{ content: '默认待办', link: '', dueDate: '' }],
      tableColumns: ['name', 'progress'],
      preReleaseRound: 'B2系统测试',
      defaultCategoryId: 'cat-1',
      defaultAppId: 'app-1',
      // 非旧配置字段应原样保留
      savedFilters: [{ id: '1', name: 'f' }],
      autoBackup: true,
    };
    const { plugin, vault } = createMockPlugin({ loadData: vi.fn(async () => legacy) });
    const svc = new DataConfigService(plugin as any);
    await svc.load();

    expect(svc.config.progressStages).toEqual([{ name: '自定义阶段', color: '#ff0000' }]);
    expect(svc.config.responsiblePersons).toEqual(['张三', '李四']);
    expect(svc.config.defaultTodos).toEqual([{ content: '默认待办', link: '', dueDate: '' }]);
    expect(svc.config.preReleaseRound).toBe('B2系统测试');
    expect(svc.config.defaultCategoryId).toBe('cat-1');
    expect(svc.config.defaultAppId).toBe('app-1');

    // 配置已写入 {dataPath}/.workflow-hub-config.json
    expect(vault.create).toHaveBeenCalledWith(
      'workflow-hub/.workflow-hub-config.json',
      expect.stringContaining('自定义阶段'),
    );

    // 旧字段已从 plugin data 清理，其余字段保留
    const cleaned = (plugin.saveData as any).mock.calls[0][0];
    expect(cleaned.progressStages).toBeUndefined();
    expect(cleaned.responsiblePersons).toBeUndefined();
    expect(cleaned.defaultTodos).toBeUndefined();
    expect(cleaned.savedFilters).toEqual([{ id: '1', name: 'f' }]);
    expect(cleaned.autoBackup).toBe(true);
  });

  it('配置文件已存在时不执行旧版迁移', async () => {
    const file = new TFile();
    file.path = 'workflow-hub/.workflow-hub-config.json';
    const { plugin, vault } = createMockPlugin({
      loadData: vi.fn(async () => ({ progressStages: [{ name: '旧阶段', color: '#000000' }] })),
    });
    vault.getAbstractFileByPath.mockImplementation((p: string) => (p === file.path ? file : null));
    vault.adapter.read.mockResolvedValue(
      JSON.stringify({ preReleaseRound: 'B4系统测试', progressStages: [{ name: '新阶段', color: '#00ff00' }] }),
    );

    const svc = new DataConfigService(plugin as any);
    await svc.load();

    expect(svc.config.preReleaseRound).toBe('B4系统测试');
    expect(svc.config.progressStages).toEqual([{ name: '新阶段', color: '#00ff00' }]);
    // 未触发迁移清理
    expect(plugin.saveData).not.toHaveBeenCalled();
  });

  it('save() 将配置写入数据目录', async () => {
    const { plugin, vault } = createMockPlugin();
    const svc = new DataConfigService(plugin as any);
    await svc.load();

    svc.config.preReleaseRound = 'B4系统测试';
    await svc.save();

    expect(vault.create).toHaveBeenCalledWith(
      'workflow-hub/.workflow-hub-config.json',
      expect.stringContaining('B4系统测试'),
    );
  });

  // ---------- 绝对路径模式（走 fs 模块，历史 bug 重灾区，此前零覆盖） ----------

  it('load() 绝对路径模式：配置文件存在时直接解析', async () => {
    const { plugin, vault } = createMockPluginAbsolute();
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(
      JSON.stringify({ preReleaseRound: 'B4系统测试', progressStages: [{ name: '绝对阶段', color: '#abcabc' }] }),
    );

    const svc = new DataConfigService(plugin as any);
    await svc.load();

    expect(svc.config.preReleaseRound).toBe('B4系统测试');
    expect(svc.config.progressStages).toEqual([{ name: '绝对阶段', color: '#abcabc' }]);
    // 绝对路径模式只走 fs，不应触发 vault 写入或旧版迁移
    expect(plugin.saveData).not.toHaveBeenCalled();
    expect(vault.create).not.toHaveBeenCalled();
  });

  it('load() 绝对路径模式：配置文件不存在时回退默认配置', async () => {
    const { plugin } = createMockPluginAbsolute();
    existsSync.mockReturnValue(false);

    const svc = new DataConfigService(plugin as any);
    await svc.load();

    expect(svc.config.progressStages).toHaveLength(7);
    expect(svc.config.tableColumns).toContain('name');
  });

  it('load() 绝对路径模式：配置文件损坏时回退默认且不崩溃', async () => {
    const { plugin } = createMockPluginAbsolute();
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('{ 这不是合法 JSON');

    const svc = new DataConfigService(plugin as any);
    await svc.load();

    expect(svc.config.progressStages).toHaveLength(7);
    expect(plugin.saveData).not.toHaveBeenCalled();
  });

  it('save() 绝对路径模式：写入文件并确保父目录存在', async () => {
    const { plugin } = createMockPluginAbsolute();
    // 父目录不存在 → 应触发 mkdirSync
    existsSync.mockReturnValue(false);

    const svc = new DataConfigService(plugin as any);
    await svc.load();

    svc.config.preReleaseRound = 'B4系统测试';
    await svc.save();

    expect(mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      'workflow-hub/.workflow-hub-config.json',
      expect.stringContaining('B4系统测试'),
      'utf-8',
    );
  });
});
