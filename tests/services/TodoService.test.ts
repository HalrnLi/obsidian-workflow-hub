import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fs', () => {
  const mockStat = () => ({ isFile: () => true, ctime: new Date('2026-01-01'), mtime: new Date('2026-01-15'), size: 128 });
  const mod = {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '---\nid: mock-id\ncontent: mock\n---\n'),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(mockStat),
    renameSync: vi.fn(),
    promises: {
      readFile: vi.fn(async () => '---\nid: mock-id\ncontent: mock\n---\n'),
      writeFile: vi.fn(async () => {}),
      unlink: vi.fn(async () => {}),
      rename: vi.fn(async () => {}),
    },
  };
  return { ...mod, default: mod };
});

vi.mock('../../src/main', () => ({ default: class {} }));

vi.mock('path', () => {
  const path = {
    join: (...args: string[]) => args.join('/'),
    isAbsolute: (p: string) => p.startsWith('/') || /^[A-Za-z]:/.test(p),
    basename: (p: string, ext?: string) => {
      const base = p.split('/').pop() || '';
      return ext ? base.replace(new RegExp(ext.replace('.', '\\.') + '$'), '') : base;
    },
    dirname: (p: string) => {
      const i = p.lastIndexOf('/');
      return i >= 0 ? p.slice(0, i) : '';
    },
    extname: (p: string) => {
      const base = p.split('/').pop() || '';
      const i = base.lastIndexOf('.');
      return i >= 0 ? base.slice(i) : '';
    },
  };
  return { ...path, default: path };
});

import { App, Vault } from 'obsidian';
import { TodoService } from '../../src/services/TodoService';
import { Todo } from '../../src/types';

function createMockPlugin() {
  const app = new App();
  const vault = new Vault();
  Object.assign(vault, {
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => '---\nid: mock\ncontent: mock\n---\n'),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    delete: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    createFolder: vi.fn(async () => {}),
    getMarkdownFiles: vi.fn(() => []),
  });
  app.vault = vault;

  const plugin = {
    app,
    settings: {
      dataPath: 'workflow-hub',
      responsiblePersons: ['张三', '李四'],
      progressStages: [],
      defaultTodos: [],
      overdueWarningDays: 3,
    },
    dataService: {
      pathResolver: {
        isAbsolutePath: () => false,
        joinPath: (...parts: string[]) => parts.join('/'),
      },
      getProjectById: vi.fn(async () => null),
    },
    categoryService: { getAll: vi.fn(async () => []) },
    todoService: null as TodoService | null,
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
  return plugin;
}

describe('TodoService 负责人筛选', () => {
  let service: TodoService;
  let plugin: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    plugin = createMockPlugin();
    service = new TodoService(plugin as any);
    plugin.todoService = service;
  });

  it('默认当前负责人为空（显示全部）', () => {
    expect(service.getCurrentResponsiblePerson()).toBe('');
  });

  it('可以设置当前负责人', () => {
    service.setCurrentResponsiblePerson('张三');
    expect(service.getCurrentResponsiblePerson()).toBe('张三');
  });

  it('创建待办时自动分配当前负责人', async () => {
    service.setCurrentResponsiblePerson('张三');
    const todo = await service.create({ content: '测试待办' });
    expect(todo.responsiblePerson).toBe('张三');
  });

  it('创建待办时使用输入中的 responsiblePerson', async () => {
    service.setCurrentResponsiblePerson('张三');
    const todo = await service.create({ content: '测试待办', responsiblePerson: '李四' });
    expect(todo.responsiblePerson).toBe('李四');
  });

  it('项目有负责人时，项目待办默认负责人与项目负责人一致', async () => {
    (plugin.dataService.getProjectById as any).mockResolvedValue({ id: 'p1', responsiblePerson: '张三' });
    const todo = await service.create({ content: '项目待办', projectId: 'p1' });
    expect(todo.responsiblePerson).toBe('张三');
  });

  it('项目无负责人时，回退到当前选中的负责人', async () => {
    (plugin.dataService.getProjectById as any).mockResolvedValue({ id: 'p1', responsiblePerson: '' });
    service.setCurrentResponsiblePerson('李四');
    const todo = await service.create({ content: '项目待办', projectId: 'p1' });
    expect(todo.responsiblePerson).toBe('李四');
  });

  it('项目不存在时，回退到当前选中的负责人', async () => {
    (plugin.dataService.getProjectById as any).mockResolvedValue(null);
    service.setCurrentResponsiblePerson('李四');
    const todo = await service.create({ content: '项目待办', projectId: 'p1' });
    expect(todo.responsiblePerson).toBe('李四');
  });

  it('显式传入负责人优先于项目负责人', async () => {
    (plugin.dataService.getProjectById as any).mockResolvedValue({ id: 'p1', responsiblePerson: '张三' });
    const todo = await service.create({ content: '项目待办', projectId: 'p1', responsiblePerson: '王五' });
    expect(todo.responsiblePerson).toBe('王五');
  });

  it('编辑待办可以修改负责人', async () => {
    const todo = await service.create({ content: '改负责人', responsiblePerson: '张三' });
    // 模拟索引已加载，直接基于内存索引更新
    service['loaded'] = true;
    const updated = await service.update(todo.id, { responsiblePerson: '李四' });
    expect(updated.responsiblePerson).toBe('李四');
    expect(updated.version).toBe(todo.version + 1);
  });

  it('getResponsiblePersons 返回所有有待办的负责人', () => {
    // 直接操作索引，绕过文件 I/O
    const mockTodos: Todo[] = [
      { id: '1', content: 'a', responsiblePerson: '张三', link: '', dueDate: '', priority: '', status: 'todo', pinned: false, categoryId: null, projectId: null, completedAt: '', createdAt: '', updatedAt: '', version: 1 },
      { id: '2', content: 'b', responsiblePerson: '李四', link: '', dueDate: '', priority: '', status: 'todo', pinned: false, categoryId: null, projectId: null, completedAt: '', createdAt: '', updatedAt: '', version: 1 },
      { id: '3', content: 'c', responsiblePerson: '张三', link: '', dueDate: '', priority: '', status: 'todo', pinned: false, categoryId: null, projectId: null, completedAt: '', createdAt: '', updatedAt: '', version: 1 },
    ];
    // @ts-expect-error 访问私有方法用于测试
    mockTodos.forEach((t) => service['indexAdd'](t));
    service['loaded'] = true;

    const persons = service.getResponsiblePersons();
    expect(persons).toEqual(['张三', '李四']);
  });

  it('getAllTodos 按当前负责人筛选', async () => {
    const mockTodos: Todo[] = [
      { id: '1', content: 'a', responsiblePerson: '张三', link: '', dueDate: '', priority: '', status: 'todo', pinned: false, categoryId: null, projectId: null, completedAt: '', createdAt: '', updatedAt: '', version: 1 },
      { id: '2', content: 'b', responsiblePerson: '张三', link: '', dueDate: '', priority: '', status: 'todo', pinned: false, categoryId: null, projectId: null, completedAt: '', createdAt: '', updatedAt: '', version: 1 },
      { id: '3', content: 'c', responsiblePerson: '李四', link: '', dueDate: '', priority: '', status: 'todo', pinned: false, categoryId: null, projectId: null, completedAt: '', createdAt: '', updatedAt: '', version: 1 },
      { id: '4', content: 'd', responsiblePerson: '', link: '', dueDate: '', priority: '', status: 'todo', pinned: false, categoryId: null, projectId: null, completedAt: '', createdAt: '', updatedAt: '', version: 1 },
    ];
    // @ts-expect-error 访问私有方法用于测试
    mockTodos.forEach((t) => service['indexAdd'](t));
    service['loaded'] = true;

    // 无筛选时返回全部
    expect(await service.getAllTodos()).toHaveLength(4);

    // 筛选张三
    service.setCurrentResponsiblePerson('张三');
    const zhangTodos = await service.getAllTodos();
    expect(zhangTodos).toHaveLength(2);
    expect(zhangTodos.every((t) => t.responsiblePerson === '张三')).toBe(true);

    // 筛选李四
    service.setCurrentResponsiblePerson('李四');
    const liTodos = await service.getAllTodos();
    expect(liTodos).toHaveLength(1);
    expect(liTodos[0].responsiblePerson).toBe('李四');
  });

  it('queryTodos 支持 responsiblePerson 筛选', async () => {
    const mockTodos: Todo[] = [
      { id: '1', content: 'a', responsiblePerson: '张三', link: '', dueDate: '', priority: '', status: 'todo', pinned: false, categoryId: null, projectId: null, completedAt: '', createdAt: '', updatedAt: '', version: 1 },
      { id: '2', content: 'b', responsiblePerson: '李四', link: '', dueDate: '', priority: '', status: 'todo', pinned: false, categoryId: null, projectId: null, completedAt: '', createdAt: '', updatedAt: '', version: 1 },
      { id: '3', content: 'c', responsiblePerson: '', link: '', dueDate: '', priority: '', status: 'todo', pinned: false, categoryId: null, projectId: null, completedAt: '', createdAt: '', updatedAt: '', version: 1 },
    ];
    // @ts-expect-error 访问私有方法用于测试
    mockTodos.forEach((t) => service['indexAdd'](t));
    service['loaded'] = true;

    const zhangTodos = await service.queryTodos({ responsiblePerson: '张三' });
    expect(zhangTodos).toHaveLength(1);

    const unassigned = await service.queryTodos({ responsiblePerson: '' });
    expect(unassigned).toHaveLength(1);
  });
});

describe('vault 事件监听', () => {
  let service: TodoService;
  let plugin: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    plugin = createMockPlugin();
    service = new TodoService(plugin as any);
    plugin.todoService = service;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('外部修改触发防抖重建索引', async () => {
    const fileA = { path: 'workflow-hub/todos/Test__todo-1.md' };
    const fileB = { path: 'workflow-hub/todos/New__todo-2.md' };
    (plugin.app.vault.getMarkdownFiles as any).mockReturnValue([fileA]);
    (plugin.app.vault.adapter.read as any).mockImplementation(async (p: string) => {
      if (String(p).includes('todo-2')) return '---\nid: todo-2\ncontent: New\nstatus: todo\n---\n';
      return '---\nid: todo-1\ncontent: Test\nstatus: todo\n---\n';
    });

    await service.loadAllIndexes();
    expect(await service.getAllTodos()).toHaveLength(1);

    service.registerVaultEvents();
    // 外部新增了一个待办文件（模拟 Obsidian Sync / 手工编辑）
    (plugin.app.vault.getMarkdownFiles as any).mockReturnValue([fileA, fileB]);
    (plugin.app.vault as any).triggerEvent('modify', { path: fileB.path });

    // 防抖间隔内不重建
    await vi.advanceTimersByTimeAsync(100);
    expect(await service.getAllTodos()).toHaveLength(1);

    // 超过防抖间隔后重建索引
    await vi.advanceTimersByTimeAsync(300);
    expect(await service.getAllTodos()).toHaveLength(2);
  });

  it('插件自身写入不触发重建', async () => {
    (plugin.app.vault.getMarkdownFiles as any).mockReturnValue([]);
    service.registerVaultEvents();
    // 先完成一次索引加载（与真实启动顺序一致）
    await service.loadAllIndexes();
    // 模拟 Obsidian：写入完成后触发 create 事件
    (plugin.app.vault.create as any).mockImplementation(async (path: string) => {
      (plugin.app.vault as any).triggerEvent('create', { path });
      return {};
    });

    await service.create({ content: 'Self' });

    // 若事件未被跳过，重建会把索引清空（磁盘 mock 无文件）
    await vi.advanceTimersByTimeAsync(1000);
    const todos = await service.getAllTodos();
    expect(todos).toHaveLength(1);
    expect(todos[0].content).toBe('Self');
  });

  it('unregisterVaultEvents 注销监听', async () => {
    service.registerVaultEvents();
    expect((plugin.app.vault as any).getHandler('modify')).toBeDefined();

    service.unregisterVaultEvents();
    expect((plugin.app.vault as any).getHandler('modify')).toBeUndefined();
    expect((plugin.app.vault as any).getHandler('create')).toBeUndefined();
    expect((plugin.app.vault as any).getHandler('delete')).toBeUndefined();
  });
});
