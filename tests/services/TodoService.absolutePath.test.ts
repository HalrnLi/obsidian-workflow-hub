import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 循环依赖：TodoService -> main -> TodoService
vi.mock('../../src/main', () => ({ default: class {} }));

import { App, Vault } from 'obsidian';
import { TodoService } from '../../src/services/TodoService';

/**
 * 绝对路径模式下待办 CRUD 的真实文件系统测试。
 *
 * 回归目标：数据路径使用绝对路径时，新增待办曾报
 * "Failed to resolve module specifier 'fs'" —— 根因是 fsUtils 里的
 * `await import('fs')` 被 esbuild 原样保留为原生 `import("fs")`，而 Obsidian
 * 渲染进程无法解析裸模块说明符。本测试不 mock `fs`/`path`，直接走真实文件
 * 系统，确保修复后完整流程（建目录 → 写文件 → 索引读回 → 更新 → 删除）可用。
 */

let tmpDir: string;

function createMockPlugin(dataPath: string) {
  const app = new App();
  app.vault = new Vault();
  const plugin = {
    app,
    settings: {
      dataPath,
      responsiblePersons: [],
      progressStages: [],
      defaultTodos: [],
      overdueWarningDays: 3,
    },
    dataService: {
      pathResolver: {
        isAbsolutePath: () => true,
        joinPath: (...parts: string[]) => path.join(...parts),
      },
      getProjectById: vi.fn(async () => null),
    },
    categoryService: { getAll: vi.fn(async () => []) },
    todoService: null as TodoService | null,
    dataConfigService: {
      config: {
        progressStages: [{ name: '需求分解', color: '#6366f1' }],
        defaultTodos: [],
        responsiblePersons: [],
        defaultCategoryId: null,
        defaultAppId: null,
        preReleaseRound: 'B3集成测试',
        tableColumns: [],
      },
      load: async () => {},
      save: async () => {},
      update: async (updater: (c: unknown) => void) => updater({}),
    },
  };
  return plugin;
}

describe('TodoService 绝对路径模式（真实文件系统）', () => {
  let service: TodoService;
  let plugin: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-todo-abs-'));
    plugin = createMockPlugin(tmpDir);
    service = new TodoService(plugin as any);
    plugin.todoService = service;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('新增待办：写入 {dataPath}/todos 下的文件且能通过索引读回', async () => {
    const todo = await service.create({ content: '绝对路径待办' });
    expect(todo.id).toBeTruthy();

    const filePath = path.join(tmpDir, 'todos', `${todo.content}__${todo.id}.md`);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain(`id: ${todo.id}`);
    expect(content).toContain('content: 绝对路径待办');

    // 索引从磁盘重建后能读到
    const fromIndex = await service.getAllTodos();
    expect(fromIndex).toHaveLength(1);
    expect(fromIndex[0].id).toBe(todo.id);
    expect(fromIndex[0].content).toBe('绝对路径待办');
  });

  it('新增带负责人的待办：写入负责人子目录', async () => {
    const todo = await service.create({ content: '负责人的待办', responsiblePerson: '张三' });
    const filePath = path.join(tmpDir, 'todos', '张三', `${todo.content}__${todo.id}.md`);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('更新待办：新内容落盘、旧文件删除、version 递增', async () => {
    const todo = await service.create({ content: '待更新' });
    const updated = await service.update(todo.id, { content: '已更新' });
    expect(updated.version).toBe(todo.version + 1);

    const newPath = path.join(tmpDir, 'todos', `已更新__${todo.id}.md`);
    expect(fs.existsSync(newPath)).toBe(true);
    expect(fs.readFileSync(newPath, 'utf-8')).toContain('content: 已更新');
    const oldPath = path.join(tmpDir, 'todos', `待更新__${todo.id}.md`);
    expect(fs.existsSync(oldPath)).toBe(false);
  });

  it('删除待办：文件从磁盘移除', async () => {
    const todo = await service.create({ content: '待删除' });
    await service.delete(todo.id);
    const filePath = path.join(tmpDir, 'todos', `待删除__${todo.id}.md`);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(await service.getAllTodos()).toHaveLength(0);
  });
});
