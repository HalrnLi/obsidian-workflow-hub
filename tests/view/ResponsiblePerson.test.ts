import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 循环依赖：view -> main -> view
vi.mock('../../src/main', () => ({ default: class {} }));

import { App } from 'obsidian';
import { ResponsiblePersonModal } from '../../src/view/modals/ResponsiblePersonModal';
import { TodoTabView } from '../../src/view/TodoTabView';
import { DataConfigService } from '../../src/services/DataConfigService';
import { FilePathResolver } from '../../src/utils/FilePathResolver';

/**
 * 负责人管理功能的 DOM 级交互测试。
 *
 * 回归背景：负责人管理被反馈"点击无反应"。本测试用升级后的 obsidian mock
 * （Modal.open 触发 onOpen、onClick/onChange 挂真实事件）模拟真实点击链路：
 * 打开弹窗 → 添加/重命名/删除/排序 → 配置落盘并读回。
 */

function createFakePlugin(persons: string[]) {
  const app = new App();
  const plugin = {
    app,
    dataConfigService: {
      config: { responsiblePersons: [...persons] },
      save: vi.fn(async () => {}),
    },
  };
  return plugin;
}

/** 模拟在输入框中输入文本（触发 input 事件） */
function typeText(inputEl: HTMLInputElement, value: string): void {
  inputEl.value = value;
  inputEl.dispatchEvent(new Event('input'));
}

/** 模拟点击按钮 */
function clickButton(btn: HTMLButtonElement): void {
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** 等待异步 onClick 处理 + 重渲染完成（宏任务级刷新，确保 renderList 已执行） */
async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

/** 获取 .avm-person-list 下所有 setting 行 */
function getRows(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>('.setting-item')];
}

describe('ResponsiblePersonModal', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-person-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('打开弹窗渲染负责人列表与新增行', () => {
    const plugin = createFakePlugin(['张三', '李四']);
    const modal = new ResponsiblePersonModal(plugin.app as any, plugin as any);
    modal.open();

    expect(modal.contentEl.querySelector('h2')?.textContent).toBe('负责人管理');
    const list = modal.contentEl.querySelector('.avm-person-list') as HTMLElement;
    expect(list).toBeTruthy();

    const rows = getRows(list);
    // 2 个负责人行 + 1 个新增行
    expect(rows.length).toBe(3);
    expect(list.textContent).toContain('负责人 1');
    expect(list.textContent).toContain('负责人 2');
    expect(list.textContent).toContain('添加新负责人');

    // 负责人输入框回显当前值
    const inputs = list.querySelectorAll('input');
    expect(inputs[0].value).toBe('张三');
    expect(inputs[1].value).toBe('李四');
  });

  it('点击"添加"新增负责人并保存', async () => {
    const plugin = createFakePlugin(['张三']);
    const onChange = vi.fn();
    const modal = new ResponsiblePersonModal(plugin.app as any, plugin as any, onChange);
    modal.open();

    const list = modal.contentEl.querySelector('.avm-person-list') as HTMLElement;
    const rows = getRows(list);
    const addRow = rows[rows.length - 1];
    const input = addRow.querySelector('input') as HTMLInputElement;
    const addBtn = addRow.querySelector('button') as HTMLButtonElement;

    typeText(input, '王五');
    clickButton(addBtn);
    await flushAsync();

    expect(plugin.dataConfigService.config.responsiblePersons).toEqual(['张三', '王五']);
    expect(plugin.dataConfigService.save).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalled();

    // 重新渲染后出现新行
    const inputs = list.querySelectorAll('input');
    expect(inputs.length).toBe(3);
  });

  it('空名称不允许添加', async () => {
    const plugin = createFakePlugin(['张三']);
    const modal = new ResponsiblePersonModal(plugin.app as any, plugin as any);
    modal.open();

    const list = modal.contentEl.querySelector('.avm-person-list') as HTMLElement;
    const rows = getRows(list);
    const addRow = rows[rows.length - 1];
    const addBtn = addRow.querySelector('button') as HTMLButtonElement;

    clickButton(addBtn);
    await flushAsync();

    expect(plugin.dataConfigService.config.responsiblePersons).toEqual(['张三']);
    expect(plugin.dataConfigService.save).not.toHaveBeenCalled();
  });

  it('重名不允许添加', async () => {
    const plugin = createFakePlugin(['张三']);
    const modal = new ResponsiblePersonModal(plugin.app as any, plugin as any);
    modal.open();

    const list = modal.contentEl.querySelector('.avm-person-list') as HTMLElement;
    const rows = getRows(list);
    const addRow = rows[rows.length - 1];
    typeText(addRow.querySelector('input') as HTMLInputElement, '张三');
    clickButton(addRow.querySelector('button') as HTMLButtonElement);
    await flushAsync();

    expect(plugin.dataConfigService.config.responsiblePersons).toEqual(['张三']);
    expect(plugin.dataConfigService.save).not.toHaveBeenCalled();
  });

  it('编辑行重命名负责人并保存', async () => {
    const plugin = createFakePlugin(['张三', '李四']);
    const modal = new ResponsiblePersonModal(plugin.app as any, plugin as any);
    modal.open();

    const list = modal.contentEl.querySelector('.avm-person-list') as HTMLElement;
    const rows = getRows(list);
    const firstRow = rows[0];
    const input = firstRow.querySelector('input') as HTMLInputElement;
    // 行内按钮顺序：[上移, 下移, 保存, 删除]
    const buttons = firstRow.querySelectorAll('button');

    typeText(input, '张三丰');
    clickButton(buttons[2]);
    await flushAsync();

    expect(plugin.dataConfigService.config.responsiblePersons).toEqual(['张三丰', '李四']);
    // 重命名后重新渲染，输入框为新值
    const inputs = list.querySelectorAll('input');
    expect(inputs[0].value).toBe('张三丰');
  });

  it('点击删除移除负责人', async () => {
    const plugin = createFakePlugin(['张三', '李四']);
    const modal = new ResponsiblePersonModal(plugin.app as any, plugin as any);
    modal.open();

    const list = modal.contentEl.querySelector('.avm-person-list') as HTMLElement;
    const rows = getRows(list);
    const buttons = rows[0].querySelectorAll('button');

    clickButton(buttons[3]);
    await flushAsync();

    expect(plugin.dataConfigService.config.responsiblePersons).toEqual(['李四']);
  });

  it('上移/下移调整负责人顺序', async () => {
    const plugin = createFakePlugin(['张三', '李四', '王五']);
    const modal = new ResponsiblePersonModal(plugin.app as any, plugin as any);
    modal.open();

    const list = modal.contentEl.querySelector('.avm-person-list') as HTMLElement;

    // 第二行（李四）上移
    const rows1 = getRows(list);
    const secondRowButtons = rows1[1].querySelectorAll('button');
    clickButton(secondRowButtons[0]);
    await flushAsync();
    expect(plugin.dataConfigService.config.responsiblePersons).toEqual(['李四', '张三', '王五']);

    // 第一行（李四）下移
    const rows2 = getRows(list);
    const firstRowButtons = rows2[0].querySelectorAll('button');
    clickButton(firstRowButtons[1]);
    await flushAsync();
    expect(plugin.dataConfigService.config.responsiblePersons).toEqual(['张三', '李四', '王五']);
  });

  it('保存失败时回滚配置并刷新列表（不静默失败）', async () => {
    const plugin = createFakePlugin(['张三']);
    plugin.dataConfigService.save.mockRejectedValueOnce(new Error('磁盘写入失败'));
    const modal = new ResponsiblePersonModal(plugin.app as any, plugin as any);
    modal.open();

    const list = modal.contentEl.querySelector('.avm-person-list') as HTMLElement;
    const rows = getRows(list);
    const addRow = rows[rows.length - 1];
    typeText(addRow.querySelector('input') as HTMLInputElement, '王五');
    clickButton(addRow.querySelector('button') as HTMLButtonElement);
    await flushAsync();

    // 配置回滚，列表按原状重新渲染（而非卡死）
    expect(plugin.dataConfigService.config.responsiblePersons).toEqual(['张三']);
    const inputs = list.querySelectorAll('input');
    expect(inputs.length).toBe(2); // 张三 + 新增行
  });

  it('视图刷新抛错不影响弹窗自身列表更新', async () => {
    const plugin = createFakePlugin(['张三']);
    const onChange = vi.fn(() => {
      throw new Error('render boom');
    });
    const modal = new ResponsiblePersonModal(plugin.app as any, plugin as any, onChange);
    modal.open();

    const list = modal.contentEl.querySelector('.avm-person-list') as HTMLElement;
    const rows = getRows(list);
    const addRow = rows[rows.length - 1];
    typeText(addRow.querySelector('input') as HTMLInputElement, '王五');
    clickButton(addRow.querySelector('button') as HTMLButtonElement);
    await flushAsync();

    // 数据已保存，弹窗列表已刷新
    expect(plugin.dataConfigService.config.responsiblePersons).toEqual(['张三', '王五']);
    expect(onChange).toHaveBeenCalled();
    const inputs = list.querySelectorAll('input');
    expect(inputs.length).toBe(3); // 张三 + 王五 + 新增行
  });

  it('真实 DataConfigService + 真实文件系统：添加负责人持久化并可读回', async () => {
    const app = new App();
    const plugin = {
      app,
      settings: { dataPath: tmpDir },
      dataService: { pathResolver: new FilePathResolver(() => tmpDir) },
      loadData: vi.fn(async () => ({})),
      saveData: vi.fn(async () => {}),
    } as any;
    const dcs = new DataConfigService(plugin);
    await dcs.load();
    expect(dcs.config.responsiblePersons).toEqual([]);

    // 通过弹窗添加负责人 → 真实落盘
    const modal = new ResponsiblePersonModal(app, { app, dataConfigService: dcs } as any);
    modal.open();
    const list = modal.contentEl.querySelector('.avm-person-list') as HTMLElement;
    const rows = getRows(list);
    const addRow = rows[rows.length - 1];
    typeText(addRow.querySelector('input') as HTMLInputElement, '张三');
    clickButton(addRow.querySelector('button') as HTMLButtonElement);
    await flushAsync();

    // 配置文件写入磁盘
    const configPath = path.join(tmpDir, '.workflow-hub-config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.readFileSync(configPath, 'utf-8')).toContain('张三');

    // 重新创建服务读回
    const dcs2 = new DataConfigService(plugin);
    await dcs2.load();
    expect(dcs2.config.responsiblePersons).toEqual(['张三']);
  });
});

describe('TodoTabView 管理负责人入口', () => {
  it('点击 users 按钮打开负责人管理弹窗', async () => {
    const containerEl = document.createElement('div');
    const app = new App();
    Object.assign(app.vault, { getMarkdownFiles: vi.fn(() => []) });

    const plugin = {
      app,
      settings: { dataPath: 'workflow-hub' },
      dataService: {
        pathResolver: { isAbsolutePath: () => false, joinPath: (...parts: string[]) => parts.join('/') },
        getProjectById: vi.fn(async () => null),
      },
      todoService: {
        getCurrentResponsiblePerson: () => '',
        setCurrentResponsiblePerson: vi.fn(),
        queryTodos: vi.fn(async () => []),
        getAllTodos: vi.fn(async () => []),
      },
      categoryService: { getAll: vi.fn(async () => []) },
      reminderService: { hasReminder: () => false, getRemainingTime: () => 0 },
      dataConfigService: {
        config: {
          responsiblePersons: ['张三', '李四'],
          defaultCategoryId: null,
        },
      },
    } as any;

    const view = new TodoTabView(containerEl, plugin, vi.fn());
    await view.render();

    // 选择器栏按钮顺序：[全部, 张三, 李四, 管理负责人(users)]，取最后一个
    const selectorButtons = containerEl.querySelectorAll('.avm-person-selector button');
    expect(selectorButtons.length).toBe(4);
    const usersBtn = selectorButtons[selectorButtons.length - 1] as HTMLButtonElement;

    const onOpenSpy = vi.spyOn(ResponsiblePersonModal.prototype, 'onOpen');
    clickButton(usersBtn);
    expect(onOpenSpy).toHaveBeenCalled();
    onOpenSpy.mockRestore();
  });
});
