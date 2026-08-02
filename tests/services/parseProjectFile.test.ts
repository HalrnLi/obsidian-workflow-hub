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
    dataConfigService: {
      config: {
        progressStages: [
          { name: '需求分解', color: '#6366f1' },
          { name: '配置组件填写', color: '#8b5cf6' },
          { name: '组件上传', color: '#ec4899' },
          { name: '自测验证', color: '#f59e0b' },
          { name: '待提测', color: '#f97316' },
          { name: '已提测', color: '#3b82f6' },
          { name: '已发布', color: '#10b981' },
        ],
        defaultTodos: [],
        responsiblePersons: [],
        defaultCategoryId: null,
        defaultAppId: null,
        preReleaseRound: 'B3集成测试',
        tableColumns: ['name', 'appVersion', 'manager', 'responsiblePerson', 'features', 'spec', 'progress', 'currentRound', 'nextStage', 'nextStageTime', 'links', 'todos'],
      },
      load: async () => {},
      save: async () => {},
      update: async (updater) => { updater({}); },
    },
  };

  return { plugin, app, vault };
}

function makeProjectFile(id: string, name: string): TFile {
  const file = new TFile();
  file.path = `workflow-hub/projects/${name}__${id}.md`;
  file.basename = `${name}__${id}`;
  file.extension = 'md';
  file.stat = { ctime: Date.parse('2026-01-01'), mtime: Date.parse('2026-01-15') };
  (file as any).readContent = vi.fn(async () => '');
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
// parseProjectFile 测试 — 验证 YAML 解析后的类型安全
// ---------------------------------------------------------------------------
describe('DataService.parseProjectFile — YAML 解析边界', () => {
  let service: DataService;
  let mocks: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMockPlugin();
    service = new DataService(mocks.app as any, mocks.plugin as any);
  });

  it('name 字段为 null 时应返回空字符串而非 null', async () => {
    const projFile = makeProjectFile('proj-1', 'Proj');
    const folder = makeFolderWith([projFile]);

    mocks.app.vault.getAbstractFileByPath = vi.fn((path: string) => {
      if (path === 'workflow-hub/projects') return folder;
      if (path === projFile.path || path === projFile.name) return projFile;
      return null;
    });
    (projFile as any).readContent.mockResolvedValue(`---
id: proj-1
name:
versionId: ver-1
version: 1
---`);

    const projects = await service.getAllProjects();
    expect(projects).toHaveLength(1);
    // name 为 null 时应转为空字符串，不能是 null
    expect(projects[0].name).toBe('');
    // 确保 name 是字符串类型（不会导致 sanitizeFileName 报错）
    expect(typeof projects[0].name).toBe('string');
  });

  it('name 字段为数字时应转为字符串', async () => {
    const projFile = makeProjectFile('proj-1', 'Proj');
    const folder = makeFolderWith([projFile]);

    mocks.app.vault.getAbstractFileByPath = vi.fn((path: string) => {
      if (path === 'workflow-hub/projects') return folder;
      if (path === projFile.path || path === projFile.name) return projFile;
      return null;
    });
    (projFile as any).readContent.mockResolvedValue(`---
id: proj-1
name: 123
versionId: ver-1
version: 1
---`);

    const projects = await service.getAllProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('123');
    expect(typeof projects[0].name).toBe('string');
  });

  it('name 字段为对象时应转为字符串', async () => {
    const projFile = makeProjectFile('proj-1', 'Proj');
    const folder = makeFolderWith([projFile]);

    mocks.app.vault.getAbstractFileByPath = vi.fn((path: string) => {
      if (path === 'workflow-hub/projects') return folder;
      if (path === projFile.path || path === projFile.name) return projFile;
      return null;
    });
    (projFile as any).readContent.mockResolvedValue(`---
id: proj-1
name: {key: value}
versionId: ver-1
version: 1
---`);

    const projects = await service.getAllProjects();
    expect(projects).toHaveLength(1);
    // 对象应被强制转为字符串，不能是 null/undefined
    expect(typeof projects[0].name).toBe('string');
  });

  it('b1IntegrationTestTime 字段为空时应为空字符串', async () => {
    const projFile = makeProjectFile('proj-1', 'Test');
    const folder = makeFolderWith([projFile]);

    mocks.app.vault.getAbstractFileByPath = vi.fn((path: string) => {
      if (path === 'workflow-hub/projects') return folder;
      if (path === projFile.path || path === projFile.name) return projFile;
      return null;
    });
    (projFile as any).readContent.mockResolvedValue(`---
id: proj-1
name: Test
versionId: ver-1
b1IntegrationTestTime:
version: 1
---`);

    const projects = await service.getAllProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].b1IntegrationTestTime).toBe('');
  });
});
