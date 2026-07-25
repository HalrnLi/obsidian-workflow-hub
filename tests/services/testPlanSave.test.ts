import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fs module
vi.mock('fs', () => {
  const mockStat = () => ({
    isFile: () => true,
    ctime: new Date('2026-01-01'),
    mtime: new Date('2026-01-15'),
    size: 128,
  });
  const mod = {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '---\nid: mock-id\nname: mock\n---\n'),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(mockStat),
    renameSync: vi.fn(),
    promises: {
      readFile: vi.fn(async () => '---\nid: mock-id\nname: mock\n---\n'),
      writeFile: vi.fn(async () => {}),
      unlink: vi.fn(async () => {}),
      rename: vi.fn(async () => {}),
    },
  };
  return { ...mod, default: mod };
});

// Break circular dependency
vi.mock('../../src/main', () => ({
  default: class {},
}));

// Mock path module
vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
  isAbsolute: (p: string) => p.startsWith('/') || /^[A-Za-z]:/.test(p),
  basename: (p: string, ext?: string) => {
    const base = p.split('/').pop() || '';
    return ext ? base.replace(new RegExp(ext.replace('.', '\\.') + '$'), '') : base;
  },
  extname: (p: string) => {
    const base = p.split('/').pop() || '';
    const i = base.lastIndexOf('.');
    return i >= 0 ? base.slice(i) : '';
  },
  default: {
    join: (...args: string[]) => args.join('/'),
    isAbsolute: (p: string) => p.startsWith('/') || /^[A-Za-z]:/.test(p),
    basename: (p: string) => p.split('/').pop() || '',
    extname: (p: string) => {
      const base = p.split('/').pop() || '';
      const i = base.lastIndexOf('.');
      return i >= 0 ? base.slice(i) : '';
    },
  },
}));

import { App, Vault, TFile, TFolder } from 'obsidian';
import { DataService } from '../../src/services/DataService';
import { parseDateInput } from '../../src/types';

function createMockPlugin() {
  const app = new App();
  const vault = new Vault();
  Object.assign(vault, {
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => ''),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    delete: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    createFolder: vi.fn(async () => {}),
  });
  app.vault = vault;

  const plugin = {
    app,
    settings: {
      dataPath: 'workflow-hub',
      progressStages: [
        { name: '需求分解', color: '#6366f1' },
        { name: '已发布', color: '#10b981' },
      ],
      defaultTodos: [],
      overdueWarningDays: 3,
    },
    todoService: {
      create: vi.fn(async () => ({})),
      deleteByProjectId: vi.fn(async () => {}),
    },
    loadData: vi.fn(async () => ({})),
    saveData: vi.fn(async () => {}),
  };

  return { plugin, app, vault };
}

function makeProjectFile(id: string, name: string): TFile {
  const file = new TFile();
  file.path = `workflow-hub/projects/${name}__${id}.md`;
  file.basename = `${name}__${id}`;
  file.extension = 'md';
  file.stat = { ctime: Date.parse('2026-01-01'), mtime: Date.parse('2026-01-15') };
  return file;
}

function makeFolderWith(files: TFile[]): TFolder {
  const folder = new TFolder();
  folder.path = 'workflow-hub/projects';
  folder.name = 'projects';
  folder.children = files;
  return folder;
}

// ---------------------------------------------------------------------------
// 提测计划保存流集成测试
// ---------------------------------------------------------------------------
describe('提测计划保存流', () => {
  let service: DataService;
  let mocks: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMockPlugin();
    service = new DataService(mocks.app as any, mocks.plugin as any);
  });

  it('parseDateInput: MM.DD 格式应解析为标准日期', () => {
    const result = parseDateInput('1.2');
    expect(result).toBe(`${new Date().getFullYear()}-01-02`);
  });

  it('parseDateInput: YYYY-MM-DD 格式应原样返回', () => {
    expect(parseDateInput('2026-07-25')).toBe('2026-07-25');
  });

  it('parseDateInput: 空字符串应返回 null', () => {
    expect(parseDateInput('')).toBeNull();
  });

  it('updateProject 应正确保存提测时间字段', async () => {
    const projId = 'proj-1';
    const projName = 'TestProject';
    const originalYaml = `---
id: ${projId}
name: ${projName}
versionId: ver-1
progress: 需求分解
b1IntegrationTestTime: ""
version: 1
---`;

    const projFile = makeProjectFile(projId, projName);
    const folder = makeFolderWith([projFile]);

    mocks.app.vault.getAbstractFileByPath = vi.fn((path: string) => {
      if (path === 'workflow-hub/projects') return folder;
      if (path === projFile.path || path === projFile.name) return projFile;
      return null;
    });
    mocks.vault.read.mockResolvedValue(originalYaml);

    // 模拟提测计划弹窗提交的数据
    const testData = {
      b1IntegrationTestTime: parseDateInput('1.2') || '',
      b1SystemTestTime: '',
      b2IntegrationTestTime: '',
      b2SystemTestTime: '',
      b3IntegrationTestTime: '',
      b3SystemTestTime: '',
      b4IntegrationTestTime: '',
      b4SystemTestTime: '',
    };

    const result = await service.updateProject(projId, testData, 1);

    expect(result).not.toBeNull();
    expect(result!.b1IntegrationTestTime).toBe(`${new Date().getFullYear()}-01-02`);

    // 验证写入文件的内容包含正确的日期（YAML 可能加引号）
    expect(mocks.vault.modify).toHaveBeenCalled();
    const writtenContent = (mocks.vault.modify as any).mock.calls[0][1];
    const expectedDate = `${new Date().getFullYear()}-01-02`;
    // YAML 序列化可能将日期字符串加上引号: '2026-01-02' 或 2026-01-02
    const hasDate = writtenContent.includes(`b1IntegrationTestTime: '${expectedDate}'`) ||
                    writtenContent.includes(`b1IntegrationTestTime: ${expectedDate}`);
    expect(hasDate).toBe(true);
  });

  it('updateProject 不应因 name 类型问题而失败', async () => {
    const projId = 'proj-1';
    const projName = 'TestProject';
    // name 为 null 的边界情况
    const originalYaml = `---
id: ${projId}
name:
versionId: ver-1
progress: 需求分解
version: 1
---`;

    const projFile = makeProjectFile(projId, projName);
    const folder = makeFolderWith([projFile]);

    mocks.app.vault.getAbstractFileByPath = vi.fn((path: string) => {
      if (path === 'workflow-hub/projects') return folder;
      if (path === projFile.path || path === projFile.name) return projFile;
      return null;
    });
    mocks.vault.read.mockResolvedValue(originalYaml);

    const testData = {
      b1IntegrationTestTime: parseDateInput('1.2') || '',
      b1SystemTestTime: '',
      b2IntegrationTestTime: '',
      b2SystemTestTime: '',
      b3IntegrationTestTime: '',
      b3SystemTestTime: '',
      b4IntegrationTestTime: '',
      b4SystemTestTime: '',
    };

    // 不应抛出 TypeError: name.replace is not a function
    await expect(service.updateProject(projId, testData, 1)).resolves.not.toThrow();
  });
});
