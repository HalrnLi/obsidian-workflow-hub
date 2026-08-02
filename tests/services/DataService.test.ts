import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fs module (hoisted by vitest)
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

// Break circular dependency: DataService -> main -> DataService
vi.mock('../../src/main', () => ({
  default: class {},
}));

// Mock path module
vi.mock('path', () => {
  const path = {
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
  };
  return { ...path, default: path };
});

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, promises as fsPromises } from 'fs';
import { App, Vault, TFile, TFolder } from 'obsidian';
import { DataService } from '../../src/services/DataService';
import { ConcurrencyConflictError } from '../../src/types';

// ---------------------------------------------------------------------------
// Helper: build a mock plugin that DataService can use with vault I/O
// ---------------------------------------------------------------------------
function createMockPlugin(useAbsolutePath = false) {
  const app = new App();
  const vault = new Vault();

  const getAbstractFileByPath = vi.fn(() => null);
  const vaultRead = vi.fn(async () => '---\nid: mock\nname: mock\n---\n');
  const vaultModify = vi.fn(async () => {});
  const vaultCreate = vi.fn(async () => ({}));
  const vaultDelete = vi.fn(async () => {});
  const vaultRename = vi.fn(async () => {});
  const vaultCreateFolder = vi.fn(async () => {});

  Object.assign(vault, {
    getAbstractFileByPath,
    read: vaultRead,
    modify: vaultModify,
    create: vaultCreate,
    delete: vaultDelete,
    rename: vaultRename,
    createFolder: vaultCreateFolder,
  });
  app.vault = vault;

  const plugin = {
    app,
    settings: {
      dataPath: useAbsolutePath ? '/tmp/test-data' : 'app-version-manager',
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
      overdueWarningDays: 3,
    },
    todoService: {
      create: vi.fn(async () => ({})),
      deleteByProjectId: vi.fn(async () => {}),
    },
    loadData: vi.fn(async () => ({})),
    saveData: vi.fn(async () => {}),
  };

  return {
    plugin,
    app,
    vault,
    getAbstractFileByPath,
    vaultRead,
    vaultModify,
    vaultCreate,
    vaultDelete,
    vaultRename,
    vaultCreateFolder,
  };
}

// ---------------------------------------------------------------------------
// Helper: make TFile stubs for files that already exist in the vault
// ---------------------------------------------------------------------------
function makeTFile(basename: string, content: string): TFile {
  const file = new TFile();
  file.path = `app-version-manager/apps/${basename}.md`;
  file.name = `${basename}.md`;
  file.basename = basename;
  file.extension = 'md';
  file.stat = { ctime: Date.parse('2026-01-01'), mtime: Date.parse('2026-01-15') };
  // readContent is checked first in parseAppFile/parseProjectFile/parseVersionFile
  (file as any).readContent = vi.fn(async () => content);
  return file;
}

// Mock vault read to return custom content per file path
function mockVaultRead(mocks: ReturnType<typeof createMockPlugin>, pathToContent: Record<string, string>) {
  mocks.vaultRead.mockImplementation(async (file: TFile) => {
    return pathToContent[file.path] ?? pathToContent[file.name] ?? '---\nid: unknown\n---\n';
  });
}

function mockVaultGetFile(mocks: ReturnType<typeof createMockPlugin>, files: TFile[]) {
  mocks.getAbstractFileByPath.mockImplementation((path: string) => {
    return files.find((f) => f.path === path || f.name === path) ?? null;
  });
}

function mockVaultFolder(mocks: ReturnType<typeof createMockPlugin>, files: TFile[]) {
  const folder = new TFolder();
  folder.path = 'app-version-manager/apps';
  folder.name = 'apps';
  folder.children = files;
  mocks.getAbstractFileByPath.mockImplementation((path: string) => {
    if (path === 'app-version-manager/apps' || path === 'app-version-manager') {
      return folder;
    }
    return files.find((f) => f.path === path || f.name === path) ?? null;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('DataService (vault path)', () => {
  let service: DataService;
  let mocks: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMockPlugin(false);
    service = new DataService(mocks.app as any, mocks.plugin as any);
  });

  // ----- getAllApps -----
  describe('getAllApps', () => {
    it('returns empty array when no apps folder exists', async () => {
      const apps = await service.getAllApps();
      expect(apps).toEqual([]);
    });

    it('parses app files from the vault folder', async () => {
      const appFile = makeTFile(
        'MyApp__app-1',
        '---\nid: app-1\nname: MyApp\ncreatedAt: "2026-01-01"\nupdatedAt: "2026-01-15"\nversion: 1\n---\n',
      );
      const folder = new TFolder();
      folder.path = 'app-version-manager/apps';
      folder.children = [appFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/apps' || path === 'app-version-manager') return folder;
        if (path === appFile.path || path === appFile.name) return appFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue(
        '---\nid: app-1\nname: MyApp\ncreatedAt: "2026-01-01"\nupdatedAt: "2026-01-15"\nversion: 1\n---\n',
      );

      const apps = await service.getAllApps();
      expect(apps).toHaveLength(1);
      expect(apps[0].name).toBe('MyApp');
      expect(apps[0].id).toBe('app-1');
    });

    it('returns cached result on second call', async () => {
      const appFile = makeTFile('MyApp__app-1', '---\nid: app-1\nname: MyApp\ncreatedAt: "2026-01-01"\nupdatedAt: "2026-01-15"\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/apps';
      folder.children = [appFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/apps' || path === 'app-version-manager') return folder;
        if (path === appFile.path || path === appFile.name) return appFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue(
        '---\nid: app-1\nname: MyApp\ncreatedAt: "2026-01-01"\nupdatedAt: "2026-01-15"\nversion: 1\n---\n',
      );

      await service.getAllApps();
      await service.getAllApps();
      // readContent should only be called once due to caching
      expect((appFile as any).readContent).toHaveBeenCalledTimes(1);
    });
  });

  // ----- createApp -----
  describe('createApp', () => {
    it('creates a new app and invalidates cache', async () => {
      const app = await service.createApp('NewApp');
      expect(app.name).toBe('NewApp');
      expect(app.id).toBeTruthy();
      expect(app.version).toBe(1);
      expect(mocks.vaultCreate).toHaveBeenCalled();
    });

    it('throws when app name already exists', async () => {
      // Seed an existing app
      const existingApp = makeTFile('Existing__app-x', '---\nid: app-x\nname: Existing\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/apps';
      folder.children = [existingApp];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/apps' || path === 'app-version-manager') return folder;
        if (path === existingApp.path || path === existingApp.name) return existingApp;
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: app-x\nname: Existing\nversion: 1\n---\n');

      await expect(service.createApp('Existing')).rejects.toThrow('APP name already exists');
    });
  });

  // ----- updateApp -----
  describe('updateApp', () => {
    it('updates app name and renames file', async () => {
      const origFile = makeTFile('OldName__app-1', '---\nid: app-1\nname: OldName\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/apps';
      folder.children = [origFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/apps' || path === 'app-version-manager') return folder;
        if (path === origFile.path || path === origFile.name) return origFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: app-1\nname: OldName\nversion: 1\n---\n');

      // Mock findEntityFileById fallback: return the file
      // getAllApps reads apps, so we need to also handle the first read
      // The getAllApps inside updateApp will be cached from the first call
      const result = await service.updateApp('app-1', 'NewName', 1);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('NewName');
      expect(result!.version).toBe(2);
    });

    it('throws ConcurrencyConflictError on version mismatch', async () => {
      const origFile = makeTFile('App__app-1', '---\nid: app-1\nname: App\nversion: 5\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/apps';
      folder.children = [origFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/apps' || path === 'app-version-manager') return folder;
        if (path === origFile.path || path === origFile.name) return origFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: app-1\nname: App\nversion: 5\n---\n');

      await expect(service.updateApp('app-1', 'NewName', 1)).rejects.toThrow(ConcurrencyConflictError);
    });
  });

  // ----- deleteApp -----
  describe('deleteApp', () => {
    it('deletes app and cascades to versions', async () => {
      const appFile = makeTFile('App__app-1', '---\nid: app-1\nname: App\nversion: 1\n---\n');
      const verFile = makeTFile('App_v1__ver-1', '---\nid: ver-1\nappId: app-1\nversionNumber: v1\nversion: 1\n---\n');

      const appsFolder = new TFolder();
      appsFolder.path = 'app-version-manager/apps';
      appsFolder.children = [appFile];

      const versionsFolder = new TFolder();
      versionsFolder.path = 'app-version-manager/versions';
      versionsFolder.children = [verFile];

      const projectsFolder = new TFolder();
      projectsFolder.path = 'app-version-manager/projects';
      projectsFolder.children = [];

      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/apps') return appsFolder;
        if (path === 'app-version-manager/versions') return versionsFolder;
        if (path === 'app-version-manager/projects') return projectsFolder;
        if (path === 'app-version-manager') return new TFolder();
        if (path === appFile.path || path === appFile.name) return appFile;
        if (path === verFile.path || path === verFile.name) return verFile;
        return null;
      });
      // Return correct content per file path
      mocks.vaultRead.mockImplementation(async (file: TFile) => {
        if (file.path?.includes('App__app-1')) return '---\nid: app-1\nname: App\nversion: 1\n---\n';
        if (file.path?.includes('App_v1__ver-1'))
          return '---\nid: ver-1\nappId: app-1\nversionNumber: v1\nversion: 1\n---\n';
        return '---\nid: unknown\n---\n';
      });

      const result = await service.deleteApp('app-1');
      expect(result).toBe(true);
      expect(mocks.vaultDelete).toHaveBeenCalled();
    });
  });

  // ----- createVersion -----
  describe('createVersion', () => {
    it('creates a version and caches by appId', async () => {
      // Seed an app so we can use the app name in filename
      const appFile = makeTFile('TestApp__app-1', '---\nid: app-1\nname: TestApp\nversion: 1\n---\n');
      const appsFolder = new TFolder();
      appsFolder.path = 'app-version-manager/apps';
      appsFolder.children = [appFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/apps' || path === 'app-version-manager') return appsFolder;
        if (path === appFile.path || path === appFile.name) return appFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: app-1\nname: TestApp\nversion: 1\n---\n');

      const version = await service.createVersion({
        appId: 'app-1',
        versionNumber: '2.0.0',
        bllVersion: '1.0',
        ippVersion: '2.0',
        webVersion: '3.0',
      });
      expect(version.versionNumber).toBe('2.0.0');
      expect(version.appId).toBe('app-1');
      expect(version.version).toBe(1);
      expect(mocks.vaultCreate).toHaveBeenCalled();
    });
  });

  // ----- getVersionsByAppId -----
  describe('getVersionsByAppId', () => {
    it('returns versions filtered by appId, sorted descending', async () => {
      const ver1 = makeTFile('App_v2__ver-2', '---\nid: ver-2\nappId: app-1\nversionNumber: 2.0.0\nversion: 1\n---\n');
      const ver2 = makeTFile('App_v1__ver-1', '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nversion: 1\n---\n');
      const ver3 = makeTFile('Other__ver-3', '---\nid: ver-3\nappId: app-2\nversionNumber: 1.0.0\nversion: 1\n---\n');

      const folder = new TFolder();
      folder.path = 'app-version-manager/versions';
      folder.children = [ver1, ver2, ver3];

      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/versions' || path === 'app-version-manager') return folder;
        if ([ver1.path, ver2.path, ver3.path].includes(path))
          return [ver1, ver2, ver3].find((f) => f.path === path) || null;
        return null;
      });
      mocks.vaultRead.mockImplementation(async (file: TFile) => {
        if (file.path === ver1.path) return '---\nid: ver-2\nappId: app-1\nversionNumber: 2.0.0\nversion: 1\n---\n';
        if (file.path === ver2.path) return '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nversion: 1\n---\n';
        if (file.path === ver3.path) return '---\nid: ver-3\nappId: app-2\nversionNumber: 1.0.0\nversion: 1\n---\n';
        return '---\nid: unknown\n---\n';
      });

      const versions = await service.getVersionsByAppId('app-1');
      expect(versions).toHaveLength(2);
      // 按 versionNumber 降序
      expect(versions[0].versionNumber).toBe('2.0.0');
      expect(versions[1].versionNumber).toBe('1.0.0');
    });
  });

  // ----- getAllVersions -----
  describe('getAllVersions', () => {
    it('returns empty array when no versions folder', async () => {
      const versions = await service.getAllVersions();
      expect(versions).toEqual([]);
    });

    it('parses version files', async () => {
      const verFile = makeTFile('App_v1__ver-1', '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nbllVersion: 1.0\nippVersion: 2.0\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/versions';
      folder.children = [verFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/versions' || path === 'app-version-manager') return folder;
        if (path === verFile.path || path === verFile.name) return verFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue(
        '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nbllVersion: 1.0\nippVersion: 2.0\nversion: 1\n---\n',
      );

      const versions = await service.getAllVersions();
      expect(versions).toHaveLength(1);
      expect(versions[0].id).toBe('ver-1');
      expect(versions[0].versionNumber).toBe('1.0.0');
    });
  });

  // ----- updateVersion -----
  describe('updateVersion', () => {
    it('updates version fields and increments version', async () => {
      const verFile = makeTFile('App_v1__ver-1', '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/versions';
      folder.children = [verFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/versions' || path === 'app-version-manager') return folder;
        if (path === verFile.path || path === verFile.name) return verFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nversion: 1\n---\n');

      const updated = await service.updateVersion('ver-1', { bllVersion: '2.0' }, 1);
      expect(updated).not.toBeNull();
      expect(updated!.bllVersion).toBe('2.0');
      expect(updated!.version).toBe(2);
    });

    it('throws ConcurrencyConflictError on version mismatch', async () => {
      const verFile = makeTFile('App_v1__ver-1', '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nversion: 3\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/versions';
      folder.children = [verFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/versions' || path === 'app-version-manager') return folder;
        if (path === verFile.path || path === verFile.name) return verFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nversion: 3\n---\n');

      await expect(service.updateVersion('ver-1', { bllVersion: '2.0' }, 1)).rejects.toThrow(ConcurrencyConflictError);
    });
  });

  // ----- archiveVersion / unarchiveVersion -----
  describe('archiveVersion', () => {
    it('sets isArchived to true', async () => {
      const verFile = makeTFile('App_v1__ver-1', '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nisArchived: false\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/versions';
      folder.children = [verFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/versions' || path === 'app-version-manager') return folder;
        if (path === verFile.path || path === verFile.name) return verFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue(
        '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nisArchived: false\nversion: 1\n---\n',
      );

      const archived = await service.archiveVersion('ver-1', 1);
      expect(archived).not.toBeNull();
      expect(archived!.isArchived).toBe(true);
    });
  });

  describe('unarchiveVersion', () => {
    it('sets isArchived to false', async () => {
      const verFile = makeTFile('App_v1__ver-1', '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nisArchived: true\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/versions';
      folder.children = [verFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/versions' || path === 'app-version-manager') return folder;
        if (path === verFile.path || path === verFile.name) return verFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue(
        '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nisArchived: true\nversion: 1\n---\n',
      );

      const unarchived = await service.unarchiveVersion('ver-1', 1);
      expect(unarchived).not.toBeNull();
      expect(unarchived!.isArchived).toBe(false);
    });
  });

  // ----- deleteVersion -----
  describe('deleteVersion', () => {
    it('deletes version file and clears versionId from linked projects', async () => {
      const verFile = makeTFile('App_v1__ver-1', '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nversion: 1\n---\n');
      const projFile = makeTFile('Proj__proj-1', '---\nid: proj-1\nname: Proj\nversionId: ver-1\nversion: 1\n---\n');

      const versionsFolder = new TFolder();
      versionsFolder.path = 'app-version-manager/versions';
      versionsFolder.children = [verFile];

      const projectsFolder = new TFolder();
      projectsFolder.path = 'app-version-manager/projects';
      projectsFolder.children = [projFile];

      const appsFolder = new TFolder();
      appsFolder.path = 'app-version-manager/apps';
      appsFolder.children = [];

      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/versions') return versionsFolder;
        if (path === 'app-version-manager/projects') return projectsFolder;
        if (path === 'app-version-manager/apps' || path === 'app-version-manager') return appsFolder;
        if (path === verFile.path || path === verFile.name) return verFile;
        if (path === projFile.path || path === projFile.name) return projFile;
        return null;
      });
      (verFile as any).readContent.mockImplementation(async () => '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nversion: 1\n---\n');
      (projFile as any).readContent.mockImplementation(async () => '---\nid: proj-1\nname: Proj\nappVersionLinks:\n  - appId: app-1\n    versionId: ver-1\nversion: 1\n---\n');

      const result = await service.deleteVersion('ver-1');
      expect(result).toBe(true);
      expect(mocks.vaultDelete).toHaveBeenCalled();
      expect(mocks.vaultModify).toHaveBeenCalled(); // 清除关联项目的 versionId
    });
  });

  // ----- createProject -----
  describe('createProject', () => {
    it('creates a project with default progress and memo file', async () => {
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager' || path.startsWith('app-version-manager/')) return new TFolder();
        return null;
      });

      const project = await service.createProject({
        name: 'Test Project',
        manager: 'Alice',
      });
      expect(project.name).toBe('Test Project');
      expect(project.appVersionLinks).toEqual([]);
      expect(project.progress).toBe('需求分解'); // first progress stage
      expect(project.version).toBe(1);
      // Should have created project file (memo file no longer created)
      expect(mocks.vaultCreate).toHaveBeenCalledTimes(1);
    });

    it('throws when project name already exists', async () => {
      const projFile = makeTFile('Dup__proj-1', '---\nid: proj-1\nname: Dup\nversion: 1\n---\n');
      const projFolder = new TFolder();
      projFolder.path = 'app-version-manager/projects';
      projFolder.children = [projFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/projects' || path === 'app-version-manager') return projFolder;
        if (path === projFile.path || path === projFile.name) return projFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: proj-1\nname: Dup\nversion: 1\n---\n');

      await expect(service.createProject({ name: 'Dup' })).rejects.toThrow(
        'Project name already exists',
      );
    });
  });

  // ----- getAllProjects -----
  describe('getAllProjects', () => {
    it('parses project files with all fields', async () => {
      const projectYaml = `---
id: proj-1
name: Full Project
versionId: ver-1
manager: Bob
progress: 已提测
progressHistory: ["需求分解@2026-01-01T00:00:00.000Z", "已提测@2026-01-10T00:00:00.000Z"]
b1IntegrationTestTime: 2026-02-01
version: 3
---`;
      const projFile = makeTFile('Full__proj-1', projectYaml);
      const folder = new TFolder();
      folder.path = 'app-version-manager/projects';
      folder.children = [projFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/projects' || path === 'app-version-manager') return folder;
        if (path === projFile.path || path === projFile.name) return projFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue(projectYaml);

      const projects = await service.getAllProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('Full Project');
      expect(projects[0].progress).toBe('已提测');
      expect(projects[0].progressHistory).toHaveLength(2);
      expect(projects[0].b1IntegrationTestTime).toBe('2026-02-01');
      expect(projects[0].version).toBe(3);
    });
  });

  // ----- updateProject -----
  describe('updateProject', () => {
    it('appends progress history when progress changes', async () => {
      const projectYaml = `---
id: proj-1
name: Progress Test
versionId: ver-1
progress: 需求分解
progressHistory: ["需求分解@2026-01-01T00:00:00.000Z"]
version: 1
---`;
      const projFile = makeTFile('Progress__proj-1', projectYaml);
      const folder = new TFolder();
      folder.path = 'app-version-manager/projects';
      folder.children = [projFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/projects' || path === 'app-version-manager') return folder;
        if (path === projFile.path || path === projFile.name) return projFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue(projectYaml);

      const updated = await service.updateProject('proj-1', { progress: '组件上传' }, 1);
      expect(updated).not.toBeNull();
      expect(updated!.progress).toBe('组件上传');
      expect(updated!.progressHistory).toHaveLength(2); // original + new entry
      expect(updated!.version).toBe(2);
    });
  });

  // ----- deleteProject -----
  describe('deleteProject', () => {
    it('deletes project file, memo, and todos', async () => {
      const projFile = makeTFile('ToDelete__proj-1', '---\nid: proj-1\nname: ToDelete\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/projects';
      folder.children = [projFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/projects' || path === 'app-version-manager') return folder;
        if (path === projFile.path || path === projFile.name) return projFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: proj-1\nname: ToDelete\nversion: 1\n---\n');

      const result = await service.deleteProject('proj-1', 1);
      expect(result).toBe(true);
      expect(mocks.vaultDelete).toHaveBeenCalled();
      expect(mocks.plugin.todoService.deleteByProjectId).toHaveBeenCalledWith('proj-1');
    });
  });

  // ----- Cache invalidation -----
  describe('cache invalidation', () => {
    it('invalidates apps cache after createApp', async () => {
      // Seed vault with one app so getAllApps has something to read
      const appFile = makeTFile('ExistingApp__app-x', '---\nid: app-x\nname: ExistingApp\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/apps';
      folder.children = [appFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/apps' || path === 'app-version-manager') return folder;
        if (path === appFile.path || path === appFile.name) return appFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: app-x\nname: ExistingApp\nversion: 1\n---\n');

      // First read populates cache
      const firstBatch = await service.getAllApps();
      expect(firstBatch).toHaveLength(1);
      const readContentSpy = (appFile as any).readContent;
      const readCountAfterFirstPopulate = readContentSpy.mock.calls.length;

      // createApp invalidates cache; its internal getAllApps should use cache
      await service.createApp('NewApp');

      // Read again — should miss cache and re-read from vault
      await service.getAllApps();
      expect(readContentSpy.mock.calls.length).toBeGreaterThan(readCountAfterFirstPopulate);
    });

    it('invalidates projects cache after createProject', async () => {
      // Seed vault with one project so getAllProjects has something to read
      const projFile = makeTFile('ExistingProj__proj-x', '---\nid: proj-x\nname: ExistingProj\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/projects';
      folder.children = [projFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager' || path.startsWith('app-version-manager/')) {
          const f = new TFolder();
          f.path = path;
          f.children = path === 'app-version-manager/projects' ? [projFile] : [];
          return f;
        }
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: proj-x\nname: ExistingProj\nversion: 1\n---\n');

      // First read populates cache
      const firstBatch = await service.getAllProjects();
      expect(firstBatch).toHaveLength(1);
      const readCountAfterFirstPopulate = mocks.vaultRead.mock.calls.length;

      await service.createProject({ name: 'NewProj', versionId: 'v1' });

      // Read again — should hit in-place updated cache, no vault re-read
      const secondBatch = await service.getAllProjects();
      expect(secondBatch).toHaveLength(2); // original + new
      // vaultRead count unchanged because cache was updated in-place
      expect(mocks.vaultRead.mock.calls.length).toBe(readCountAfterFirstPopulate);
    });
  });

  // ----- searchProjects -----
  describe('searchProjects', () => {
    it('filters by name keyword', async () => {
      const p1 = makeTFile('Alpha__p1', '---\nid: p1\nname: Alpha Project\nmanager: Alice\nversion: 1\n---\n');
      const p2 = makeTFile('Beta__p2', '---\nid: p2\nname: Beta Project\nmanager: Bob\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/projects';
      folder.children = [p1, p2];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/projects' || path === 'app-version-manager') return folder;
        if ([p1.path, p2.path].includes(path)) return [p1, p2].find((f) => f.path === path) || null;
        return null;
      });
      mocks.vaultRead.mockImplementation(async (file: TFile) => {
        if (file.path === p1.path) return '---\nid: p1\nname: Alpha Project\nmanager: Alice\nversion: 1\n---\n';
        if (file.path === p2.path) return '---\nid: p2\nname: Beta Project\nmanager: Bob\nversion: 1\n---\n';
        return '---\nid: unknown\n---\n';
      });

      const result = await service.searchProjects('Alpha');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p1');
    });
  });

  // ----- getProjectsByVersionId -----
  describe('getProjectsByVersionId', () => {
    it('returns projects filtered by versionId', async () => {
      const p1 = makeTFile('P1__p1', '---\nid: p1\nname: P1\nversionId: ver-1\nprogress: 需求分解\nversion: 1\n---\n');
      const p2 = makeTFile('P2__p2', '---\nid: p2\nname: P2\nversionId: ver-2\nprogress: 已提测\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/projects';
      folder.children = [p1, p2];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/projects' || path === 'app-version-manager') return folder;
        if ([p1.path, p2.path].includes(path)) return [p1, p2].find((f) => f.path === path) || null;
        return null;
      });
      (p1 as any).readContent.mockImplementation(async () => '---\nid: p1\nname: P1\nappVersionLinks:\n  - appId: app-1\n    versionId: ver-1\nprogress: 需求分解\nversion: 1\n---\n');
      (p2 as any).readContent.mockImplementation(async () => '---\nid: p2\nname: P2\nversionId: ver-2\nprogress: 已提测\nversion: 1\n---\n');

      const result = await service.getProjectsByVersionId('ver-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p1');
    });
  });

  // ----- getProjectById (per-project cache) -----
  describe('getProjectById', () => {
    it('hits per-project cache after getAllProjects', async () => {
      const projFile = makeTFile('Cached__p1', '---\nid: p1\nname: Cached\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/projects';
      folder.children = [projFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/projects' || path === 'app-version-manager') return folder;
        if (path === projFile.path || path === projFile.name) return projFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: p1\nname: Cached\nversion: 1\n---\n');

      // Populate cache via getAllProjects
      await service.getAllProjects();
      const readCount = mocks.vaultRead.mock.calls.length;

      // getProjectById should use per-project cache, not vaultRead
      const project = await service.getProjectById('p1');
      expect(project).not.toBeNull();
      expect(project!.name).toBe('Cached');
      expect(mocks.vaultRead.mock.calls.length).toBe(readCount);
    });
  });

  // ----- getVersionById / getAppById -----
  describe('getVersionById', () => {
    it('finds a version by id', async () => {
      const verFile = makeTFile('App_v1__ver-1', '---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/versions';
      folder.children = [verFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/versions' || path === 'app-version-manager') return folder;
        if (path === verFile.path || path === verFile.name) return verFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: ver-1\nappId: app-1\nversionNumber: 1.0.0\nversion: 1\n---\n');

      const version = await service.getVersionById('ver-1');
      expect(version).not.toBeNull();
      expect(version!.versionNumber).toBe('1.0.0');
    });
  });

  describe('getAppById', () => {
    it('finds an app by id', async () => {
      const appFile = makeTFile('TestApp__app-1', '---\nid: app-1\nname: TestApp\nversion: 1\n---\n');
      const folder = new TFolder();
      folder.path = 'app-version-manager/apps';
      folder.children = [appFile];
      mocks.getAbstractFileByPath.mockImplementation((path: string) => {
        if (path === 'app-version-manager/apps' || path === 'app-version-manager') return folder;
        if (path === appFile.path || path === appFile.name) return appFile;
        return null;
      });
      mocks.vaultRead.mockResolvedValue('---\nid: app-1\nname: TestApp\nversion: 1\n---\n');

      const app = await service.getAppById('app-1');
      expect(app).not.toBeNull();
      expect(app!.name).toBe('TestApp');
    });
  });
});

// ---------------------------------------------------------------------------
// Absolute path tests (filesystem I/O)
// ---------------------------------------------------------------------------
describe('DataService (absolute path)', () => {
  let service: DataService;
  let mocks: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMockPlugin(true);
    service = new DataService(mocks.app as any, mocks.plugin as any);
  });

  describe('getAllApps', () => {
    it('returns empty array when directory does not exist', async () => {
      (existsSync as any).mockReturnValueOnce(false);
      const apps = await service.getAllApps();
      expect(apps).toEqual([]);
    });

    it('parses app files from filesystem', async () => {
      (existsSync as any).mockReturnValue(true);
      (readdirSync as any).mockReturnValue(['MyApp__app-1.md']);
      (statSync as any).mockReturnValue({
        isFile: () => true,
        ctime: new Date('2026-01-01'),
        mtime: new Date('2026-01-15'),
      });
      (fsPromises.readFile as any).mockResolvedValue(
        '---\nid: app-1\nname: MyApp\ncreatedAt: "2026-01-01"\nupdatedAt: "2026-01-15"\nversion: 1\n---\n',
      );

      const apps = await service.getAllApps();
      expect(apps).toHaveLength(1);
      expect(apps[0].name).toBe('MyApp');
      expect(apps[0].id).toBe('app-1');
    });
  });

  describe('createApp', () => {
    it('creates app file via fs', async () => {
      (existsSync as any).mockReturnValue(true);
      (readdirSync as any).mockReturnValue([]);

      const app = await service.createApp('FsApp');
      expect(app.name).toBe('FsApp');
      // For absolute path, write goes through promises.writeFile, not writeFileSync
      expect(fsPromises.writeFile).toHaveBeenCalled();
    });
  });
});
