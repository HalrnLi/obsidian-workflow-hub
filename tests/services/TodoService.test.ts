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
    },
    categoryService: { getAll: vi.fn(async () => []) },
    todoService: null as TodoService | null,
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
