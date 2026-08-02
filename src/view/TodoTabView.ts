import { ButtonComponent, Menu, Modal, Notice } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import { Todo, TodoStatus, Category } from '../types';
import { sortTodos } from '../utils/todoSorting';
import { getPriorityConfig, isOverdueTask, isUrgentTask } from '../utils/todoUtils';
import { CreateTodoModal, CreateTodoData } from './modals/CreateTodoModal';
import { CategoryModal } from './modals/CategoryModal';
import { ConfirmModal } from './ConfirmModal';
import { openExternalLink } from '../utils/linkUtils';
import { parseLocalDate } from '../utils/dateUtils';
import { ImportExportService } from '../services/ImportExportService';
import { ResponsiblePersonModal } from './modals/ResponsiblePersonModal';

/** 临时待办（纯内存，关闭即清空） */
interface TempTask {
  id: string;
  content: string;
  link: string;
  completed: boolean;
  createdAt: number;
  responsiblePerson: string;
}

/** 待办 Tab 主视图：左侧长期待办 + 右侧临时待办 */
export class TodoTabView {
  private plugin: AppVersionManagerPlugin;
  private onRefresh?: () => void;
  private containerEl: HTMLElement;

  private categories: Category[] = [];
  private selectedPersons: string[] = [];
  private selectedCategoryId: string | null | 'all' = 'all';
  private statusFilter: TodoStatus | 'all' = 'all';
  private projectFilter: 'all' | 'bound' | 'unbound' = 'all';
  private datePreset: 'all' | 'today' | 'week' | '7days' | '30days' = 'all';
  private keyword = '';
  private searchDebounce: number | null = null;
  private tempTasks: TempTask[] = [];
  private tempPanelVisible = true;
  private isRendering = false;

  constructor(containerEl: HTMLElement, plugin: AppVersionManagerPlugin, onRefresh?: () => void) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.onRefresh = onRefresh;
  }

  async render(): Promise<void> {
    if (this.isRendering) return;
    this.isRendering = true;

    try {
      // 阶段 1：获取所有数据（纯计算，不碰 DOM）
      let todos: Todo[] = [];
      const projectCache = new Map<string, string>();
      try {
        this.categories = await this.plugin.categoryService.getAll();
      } catch (e) {
        console.error('加载分类失败', e);
      }
      this.selectedPersons = this.plugin.dataConfigService.config.responsiblePersons ?? [];

      try {
        const dateRange = this.getDateRange();
        todos = await this.plugin.todoService.queryTodos({
          categoryId: this.selectedCategoryId === 'all' ? undefined : this.selectedCategoryId,
          status: this.statusFilter === 'all' ? undefined : this.statusFilter,
          projectFilter: this.projectFilter,
          keyword: this.keyword,
          updatedDateFrom: dateRange.from,
          updatedDateTo: dateRange.to,
        });
      } catch (e) {
        console.error('查询待办失败', e);
      }

      todos = sortTodos(todos);

      // 预加载项目信息
      for (const todo of todos) {
        if (todo.projectId && !projectCache.has(todo.projectId)) {
          try {
            const p = await this.plugin.dataService.getProjectById(todo.projectId);
            projectCache.set(todo.projectId, p?.name ?? '已删除项目');
          } catch {
            projectCache.set(todo.projectId, '未知项目');
          }
        }
      }

      // 阶段 2：同步一次性渲染 DOM（无 await，不可中断）
      this.containerEl.empty();
      const wrapper = this.containerEl.createDiv({ cls: 'avm-todo-wrapper' });

      const mainEl = wrapper.createDiv({ cls: 'avm-todo-main' });
      this.renderPersonSelector(mainEl);
      this.renderCategoryTabs(mainEl);
      this.renderFilterBar(mainEl);
      this.renderListSync(mainEl, todos, projectCache);

      const toggleBtn = mainEl.createDiv({ cls: 'avm-temp-toggle-btn', text: this.tempPanelVisible ? '▶' : '◀' });
      toggleBtn.title = this.tempPanelVisible ? '收起临时待办' : '展开临时待办';
      toggleBtn.addEventListener('click', async () => {
        this.tempPanelVisible = !this.tempPanelVisible;
        await this.render();
      });

      if (this.tempPanelVisible) {
        this.renderTempPanel(wrapper);
      }
    } finally {
      this.isRendering = false;
    }
  }

  /** 同步渲染待办列表（传入预加载的数据） */
  private renderListSync(container: HTMLElement, todos: Todo[], projectCache: Map<string, string>): void {
    let listEl = container.querySelector('.avm-todo-list') as HTMLElement | null;
    if (listEl) listEl.empty();
    else listEl = container.createDiv({ cls: 'avm-todo-list' });

    if (todos.length === 0) {
      listEl.createDiv({ cls: 'avm-empty-state', text: '暂无符合条件的待办' });
      return;
    }

    for (const todo of todos) {
      this.renderTodoItem(listEl, todo, projectCache.get(todo.projectId ?? '') ?? '');
    }
  }

  // ---------- 右侧临时待办面板 ----------
  private renderTempPanel(wrapper: HTMLElement): void {
    const panel = wrapper.createDiv({ cls: 'avm-temp-panel' });

    // 标题行
    const header = panel.createDiv({ cls: 'avm-temp-header' });
    header.createSpan({ cls: 'avm-temp-title', text: '📝 临时待办' });
    const visibleCount = this.tempTasks.filter(
      (t) => !this.plugin.todoService.getCurrentResponsiblePerson() || t.responsiblePerson === this.plugin.todoService.getCurrentResponsiblePerson(),
    ).length;
    const countBadge = header.createSpan({
      cls: 'avm-temp-count',
      text: visibleCount > 0 ? String(visibleCount) : '',
    });
    const clearBtn = header.createEl('button', { text: '清除已完成', cls: 'avm-temp-clear-btn' });
    clearBtn.style.display = this.tempTasks.some((t) => t.completed) ? '' : 'none';
    clearBtn.addEventListener('click', () => {
      const person = this.plugin.todoService.getCurrentResponsiblePerson();
      this.tempTasks = this.tempTasks.filter(
        (t) => !t.completed || (person && t.responsiblePerson !== person),
      );
      this.refreshTempPanel();
    });

    // 输入行：内容 + 链接
    const inputRow = panel.createDiv({ cls: 'avm-temp-input-row' });
    const input = inputRow.createEl('input', { type: 'text', placeholder: '快速添加...', cls: 'avm-temp-input' });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addTempTask(input.value.trim(), linkInput.value.trim());
        input.value = '';
        linkInput.value = '';
      }
    });
    const addBtn = inputRow.createEl('button', { text: '+', cls: 'avm-temp-add-btn' });
    addBtn.addEventListener('click', () => {
      this.addTempTask(input.value.trim(), linkInput.value.trim());
      input.value = '';
      linkInput.value = '';
    });

    const linkRow = panel.createDiv({ cls: 'avm-temp-input-row' });
    const linkInput = linkRow.createEl('input', {
      type: 'text',
      placeholder: '链接（可选）...',
      cls: 'avm-temp-input',
    });

    // 任务列表（按当前负责人筛选）
    const list = panel.createDiv({ cls: 'avm-temp-list' });
    const currentPerson = this.plugin.todoService.getCurrentResponsiblePerson();
    const visibleTasks = this.tempTasks.filter(
      (t) => !currentPerson || t.responsiblePerson === currentPerson,
    );
    visibleTasks.forEach((task) => this.renderTempTask(list, task));
  }

  /** 刷新临时待办面板（不重建整个视图） */
  private refreshTempPanel(): void {
    const panel = this.containerEl.querySelector('.avm-temp-panel');
    if (!panel) return;
    const wrapper = panel.parentElement;
    if (!wrapper) return;
    panel.remove();
    this.renderTempPanel(wrapper);
  }

  private addTempTask(content: string, link: string): void {
    if (!content) return;
    this.tempTasks.unshift({
      id: `temp-${Date.now()}`,
      content,
      link: link || '',
      completed: false,
      createdAt: Date.now(),
      responsiblePerson: this.plugin.todoService.getCurrentResponsiblePerson(),
    });
    this.refreshTempPanel();
  }

  private renderTempTask(listEl: HTMLElement, task: TempTask): void {
    const item = listEl.createDiv({ cls: 'avm-temp-item' + (task.completed ? ' avm-temp-done' : '') });

    const icon = item.createSpan({ cls: 'avm-todo-status-icon' });
    icon.setText(task.completed ? '✅' : '⏳');
    icon.addEventListener('click', () => {
      task.completed = !task.completed;
      if (task.completed) {
        this.plugin.reminderService.cancelReminder(task.id);
      }
      this.refreshTempPanel();
    });

    const content = item.createSpan({ cls: 'avm-todo-content', text: task.content });
    content.title = '双击编辑';

    // 双击编辑
    content.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.editTempTask(task);
    });

    if (task.link) {
      const linkEl = item.createEl('a', { cls: 'avm-link', text: '🔗', attr: { href: '#' } });
      linkEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openExternalLink(task.link);
      });
    }

    // 提醒图标（参考 todolist：仅当有提醒时显示 ⏰ + 剩余时间 tooltip）
    if (this.plugin.reminderService.hasReminder(task.id)) {
      const remaining = this.plugin.reminderService.getRemainingTime(task.id);
      const mins = Math.ceil(remaining / 60000);
      const reminderIcon = item.createSpan({
        cls: 'avm-todo-reminder-icon',
        text: '⏰',
        attr: { title: `${mins} 分钟后提醒` },
      });
      reminderIcon.style.marginLeft = 'auto';
    }

    // 右键菜单（含提醒设置，参考 todolist）
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showTempReminderMenu(task, e);
    });
  }

  /** 编辑临时待办（内联编辑） */
  private editTempTask(task: TempTask): void {
    const newContent = prompt('编辑待办内容', task.content);
    if (newContent !== null && newContent.trim()) {
      task.content = newContent.trim();
      const newLink = prompt('编辑链接（可选）', task.link);
      if (newLink !== null) task.link = newLink.trim();
      this.refreshTempPanel();
    }
  }

  // ---------- 临时待办提醒菜单（参考 todolist showReminderMenu） ----------

  private showTempReminderMenu(task: TempTask, event: MouseEvent): void {
    const menu = new Menu();
    const reminderService = this.plugin.reminderService;

    menu.addItem((it) => it.setTitle('📋 提醒我').setDisabled(true));

    const presets = [
      { label: '10 分钟后', ms: 10 * 60 * 1000 },
      { label: '30 分钟后', ms: 30 * 60 * 1000 },
      { label: '1 小时后', ms: 60 * 60 * 1000 },
      { label: '3 小时后', ms: 3 * 60 * 60 * 1000 },
    ];
    presets.forEach((preset) => {
      menu.addItem((it) =>
        it.setTitle(preset.label).onClick(() => {
          reminderService.setReminder(task.id, task.content, preset.ms, task.link);
          new Notice(`已设置 ${preset.label} 提醒`, 3000);
          this.refreshTempPanel();
        }),
      );
    });

    menu.addItem((it) => it.setTitle('自定义时间...').onClick(() => this.showCustomReminderModal(task)));

    if (reminderService.hasReminder(task.id)) {
      menu.addSeparator();
      const remaining = reminderService.getRemainingTime(task.id);
      const mins = Math.ceil(remaining / 60000);
      menu.addItem((it) =>
        it.setTitle(`⏰ 取消提醒 (剩余 ${mins} 分钟)`).onClick(() => {
          reminderService.cancelReminder(task.id);
          new Notice('已取消提醒', 3000);
          this.refreshTempPanel();
        }),
      );
    }

    menu.addSeparator();
    menu.addItem((it) =>
      it
        .setTitle('编辑')
        .setIcon('pencil')
        .onClick(() => this.editTempTask(task)),
    );
    if (task.link) {
      menu.addItem((it) =>
        it
          .setTitle('打开链接')
          .setIcon('external-link')
          .onClick(() => openExternalLink(task.link)),
      );
    }
    menu.addSeparator();
    menu.addItem((it) =>
      it
        .setTitle('删除')
        .setIcon('trash')
        .onClick(() => {
          this.plugin.reminderService.cancelReminder(task.id);
          this.tempTasks = this.tempTasks.filter((t) => t.id !== task.id);
          this.refreshTempPanel();
        }),
    );

    menu.showAtMouseEvent(event);
  }

  /** 自定义提醒时间弹窗 */
  private showCustomReminderModal(task: TempTask): void {
    const modal = new Modal(this.plugin.app);
    modal.titleEl.setText('设置提醒时间');

    const inputEl = modal.contentEl.createEl('input', {
      type: 'number',
      placeholder: '请输入分钟数（1-1440）',
      attr: { min: '1', max: '1440' },
    });
    inputEl.style.width = '100%';
    inputEl.style.padding = '8px';
    inputEl.style.marginTop = '8px';
    inputEl.style.marginBottom = '8px';

    const btnContainer = modal.contentEl.createEl('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.gap = '8px';
    btnContainer.style.justifyContent = 'flex-end';

    const cancelBtn = btnContainer.createEl('button', { text: '取消' });
    cancelBtn.addEventListener('click', () => modal.close());

    const confirmBtn = btnContainer.createEl('button', { text: '确定' });
    confirmBtn.style.backgroundColor = 'var(--interactive-accent)';
    confirmBtn.style.color = 'white';
    confirmBtn.style.border = 'none';
    confirmBtn.style.padding = '6px 16px';
    confirmBtn.style.borderRadius = '4px';
    confirmBtn.addEventListener('click', () => {
      const mins = parseInt(inputEl.value, 10);
      if (!inputEl.value || isNaN(mins) || mins < 1 || mins > 1440) {
        new Notice('请输入 1-1440 之间的正整数', 3000);
        return;
      }
      this.plugin.reminderService.setReminder(task.id, task.content, mins * 60 * 1000, task.link);
      new Notice(`已设置 ${mins} 分钟后提醒`, 3000);
      this.refreshTempPanel();
      modal.close();
    });

    inputEl.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter') confirmBtn.click();
    });

    modal.open();
    inputEl.focus();
  }

  // ---------- 左侧长期待办 ----------
  private renderPersonSelector(container: HTMLElement): void {
    const selectorBar = container.createDiv({ cls: 'avm-filter-bar avm-person-selector' });

    // "全部" 按钮
    const allBtn = selectorBar.createEl('button', {
      cls: 'avm-person-btn' + (!this.plugin.todoService.getCurrentResponsiblePerson() ? ' avm-person-btn-active' : ''),
      text: '全部',
    });
    allBtn.addEventListener('click', async () => {
      this.plugin.todoService.setCurrentResponsiblePerson('');
      await this.render();
    });

    // 每个负责人一个按钮
    this.selectedPersons.forEach((person) => {
      const btn = selectorBar.createEl('button', {
        cls: 'avm-person-btn' + (this.plugin.todoService.getCurrentResponsiblePerson() === person ? ' avm-person-btn-active' : ''),
        text: person,
      });
      btn.addEventListener('click', async () => {
        this.plugin.todoService.setCurrentResponsiblePerson(person);
        await this.render();
      });
    });

    // 设置按钮（管理负责人列表）
    new ButtonComponent(selectorBar)
      .setIcon('users')
      .setTooltip('管理负责人')
      .onClick(() => {
        new ResponsiblePersonModal(this.plugin.app, this.plugin, () => this.render()).open();
      });
  }

  private renderCategoryTabs(container: HTMLElement): void {
    const tabBar = container.createDiv({ cls: 'avm-tab-bar avm-category-tabs' });

    const tabs: { key: string | null | 'all'; label: string }[] = [{ key: 'all', label: '全部' }];
    this.categories.forEach((c) => tabs.push({ key: c.id, label: c.name }));
    tabs.push({ key: null, label: '未分类' });

    tabs.forEach(({ key, label }) => {
      const tabEl = tabBar.createDiv({ cls: 'avm-tab' + (this.selectedCategoryId === key ? ' avm-tab-active' : '') });
      tabEl.setText(label);
      if (key !== 'all' && key !== null) {
        const cat = this.categories.find((c) => c.id === key);
        if (cat?.color) {
          tabEl.style.borderLeft = `3px solid ${cat.color}`;
          tabEl.style.paddingLeft = '9px';
        }
      }
      tabEl.addEventListener('click', async () => {
        this.selectedCategoryId = key;
        await this.render();
      });
    });

    new ButtonComponent(tabBar)
      .setIcon('settings')
      .setButtonText('管理')
      .setTooltip('管理分类')
      .onClick(() => {
        new CategoryModal(this.plugin.app, this.plugin, () => this.render()).open();
      });
  }

  private renderFilterBar(container: HTMLElement): void {
    const bar = container.createDiv({ cls: 'avm-filter-bar' });

    const statusSelect = bar.createEl('select', { cls: 'avm-select' });
    [
      { v: 'all', t: '全部状态' },
      { v: 'todo', t: '待完成' },
      { v: 'done', t: '已完成' },
    ].forEach((o) => statusSelect.createEl('option', { value: o.v, text: o.t }));
    statusSelect.value = this.statusFilter;
    statusSelect.addEventListener('change', async (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.statusFilter = v === 'all' ? 'all' : (v as TodoStatus);
      await this.render();
    });

    const projSelect = bar.createEl('select', { cls: 'avm-select' });
    [
      { v: 'all', t: '全部' },
      { v: 'bound', t: '绑定项目' },
      { v: 'unbound', t: '未绑定' },
    ].forEach((o) => projSelect.createEl('option', { value: o.v, text: o.t }));
    projSelect.value = this.projectFilter;
    projSelect.addEventListener('change', async (e) => {
      this.projectFilter = (e.target as HTMLSelectElement).value as 'all' | 'bound' | 'unbound';
      await this.render();
    });

    const dateSelect = bar.createEl('select', { cls: 'avm-select' });
    [
      { v: 'all', t: '全部日期' },
      { v: 'today', t: '今天' },
      { v: 'week', t: '本周' },
      { v: '7days', t: '近7天' },
      { v: '30days', t: '近30天' },
    ].forEach((o) => dateSelect.createEl('option', { value: o.v, text: o.t }));
    dateSelect.value = this.datePreset;
    dateSelect.addEventListener('change', async (e) => {
      this.datePreset = (e.target as HTMLSelectElement).value as typeof this.datePreset;
      await this.render();
    });

    const searchInput = bar.createEl('input', {
      cls: 'avm-search-input',
      attr: { type: 'text', placeholder: '搜索待办内容...' },
    });
    searchInput.value = this.keyword;
    searchInput.addEventListener('input', (e) => {
      this.keyword = (e.target as HTMLInputElement).value;
      if (this.searchDebounce) clearTimeout(this.searchDebounce);
      this.searchDebounce = window.setTimeout(() => { this.render(); }, 200);
    });

    new ButtonComponent(bar)
      .setIcon('plus')
      .setButtonText('新建待办')
      .setCta()
      .onClick(() => this.showCreate());
    new ButtonComponent(bar)
      .setIcon('download')
      .setButtonText('导出CSV')
      .onClick(() => this.exportCSV());
  }


  private renderTodoItem(listEl: HTMLElement, todo: Todo, projectName: string): void {
    const item = listEl.createDiv({
      cls: 'avm-todo-item' + (todo.status === 'done' ? ' avm-todo-done' : '') + (todo.pinned ? ' avm-todo-pinned' : ''),
    });

    const icon = item.createSpan({ cls: 'avm-todo-status-icon' });
    icon.setText(todo.status === 'done' ? '◼️' : '◻️');
    icon.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const next: TodoStatus = todo.status === 'done' ? 'todo' : 'done';
        await this.plugin.todoService.update(todo.id, { status: next });
        await this.render();
        this.onRefresh?.();
      } catch (err) {
        new Notice(err instanceof Error ? err.message : String(err));
      }
    });

    const pc = getPriorityConfig(todo.priority);
    if (pc) {
      const badge = item.createSpan({ cls: 'avm-priority-badge', text: pc.label });
      badge.style.backgroundColor = pc.color;
    }

    const content = item.createSpan({ cls: 'avm-todo-content', text: todo.content });

    item.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showEdit(todo);
    });

    if (projectName) {
      item.createSpan({ cls: 'avm-todo-project-tag', text: `🏷️ ${projectName}` });
    }

    if (todo.dueDate) {
      const due = item.createSpan({ cls: 'avm-todo-due', text: `📅 ${todo.dueDate}` });
      if (isOverdueTask(todo)) due.addClass('avm-overdue-text');
      else if (isUrgentTask(todo)) due.addClass('avm-urgent-text');
    }

    if (this.plugin.reminderService.hasReminder(todo.id)) {
      const remaining = this.plugin.reminderService.getRemainingTime(todo.id);
      const mins = Math.ceil(remaining / 60000);
      item.createSpan({ cls: 'avm-todo-reminder', text: `⏰${mins}分钟后` });
    }

    if (todo.link) {
      const linkEl = item.createEl('a', { cls: 'avm-link', text: '🔗', attr: { href: '#' } });
      linkEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openExternalLink(todo.link);
      });
    }

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((it) =>
        it.setTitle(todo.pinned ? '取消置顶' : '置顶').onClick(async () => {
          await this.plugin.todoService.update(todo.id, { pinned: !todo.pinned });
          await this.render();
          this.onRefresh?.();
        }),
      );
      if (todo.dueDate) {
        const hasReminder = this.plugin.reminderService.hasReminder(todo.id);
        const dueDate = parseLocalDate(todo.dueDate);
        const now = new Date();
        if (dueDate > now) {
          const delayMs = dueDate.getTime() - now.getTime();
          menu.addItem((it) =>
            it
              .setTitle(hasReminder ? '取消提醒' : '到期提醒')
              .setIcon('bell')
              .onClick(async () => {
                if (hasReminder) {
                  this.plugin.reminderService.cancelReminder(todo.id);
                } else {
                  this.plugin.reminderService.setReminder(todo.id, todo.content, delayMs, todo.link);
                }
                await this.render();
              }),
          );
        }
      }
      menu.addSeparator();
      menu.addItem((it) =>
        it
          .setTitle('编辑')
          .setIcon('pencil')
          .onClick(() => this.showEdit(todo)),
      );
      menu.addItem((it) =>
        it
          .setTitle('删除')
          .setIcon('trash')
          .onClick(() => this.confirmDelete(todo)),
      );
      menu.showAtMouseEvent(e);
    });
  }

  private getDateRange(): { from: string | undefined; to: string | undefined } {
    const today = new Date();
    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const todayStr = fmt(today);
    switch (this.datePreset) {
      case 'today':
        return { from: todayStr, to: todayStr };
      case 'week': {
        const dayOfWeek = today.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(today);
        monday.setDate(today.getDate() + mondayOffset);
        return { from: fmt(monday), to: todayStr };
      }
      case '7days': {
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 6);
        return { from: fmt(weekAgo), to: todayStr };
      }
      case '30days': {
        const monthAgo = new Date(today);
        monthAgo.setDate(today.getDate() - 29);
        return { from: fmt(monthAgo), to: todayStr };
      }
      case 'all':
      default:
        return { from: undefined, to: undefined };
    }
  }

  private showCreate(): void {
    const defaultCategory =
      this.selectedCategoryId === 'all' || this.selectedCategoryId === null
        ? this.plugin.dataConfigService.config.defaultCategoryId
        : this.selectedCategoryId;
    new CreateTodoModal(
      this.plugin.app,
      this.plugin,
      async (data: CreateTodoData) => {
        try {
          await this.plugin.todoService.create(data);
          await this.render();
          this.onRefresh?.();
        } catch (e) {
          new Notice(e instanceof Error ? e.message : String(e));
        }
      },
      null,
    ).open();
  }

  private showEdit(todo: Todo): void {
    new CreateTodoModal(
      this.plugin.app,
      this.plugin,
      async (data: CreateTodoData) => {
        try {
          await this.plugin.todoService.update(todo.id, data, todo.version);
          await this.render();
          this.onRefresh?.();
        } catch (e) {
          new Notice(e instanceof Error ? e.message : String(e));
        }
      },
      todo,
    ).open();
  }

  private confirmDelete(todo: Todo): void {
    new ConfirmModal(
      this.plugin.app,
      '删除待办',
      `确定删除待办 "${todo.content}" 吗？`,
      async () => {
        try {
          await this.plugin.todoService.delete(todo.id);
          await this.render();
          this.onRefresh?.();
        } catch (e) {
          new Notice(e instanceof Error ? e.message : String(e));
        }
      },
      undefined,
      true,
    ).open();
  }

  private async exportCSV(): Promise<void> {
    try {
      const dateRange = this.getDateRange();
      const todos = await this.plugin.todoService.queryTodos({
        categoryId: this.selectedCategoryId === 'all' ? undefined : this.selectedCategoryId,
        status: this.statusFilter === 'all' ? undefined : this.statusFilter,
        projectFilter: this.projectFilter,
        keyword: this.keyword,
        updatedDateFrom: dateRange.from,
        updatedDateTo: dateRange.to,
      });

      if (todos.length === 0) {
        new Notice('当前没有可导出的待办');
        return;
      }

      const projectIds = new Set(todos.filter((t) => t.projectId).map((t) => t.projectId!));
      const projectNameMap = new Map<string, string>();
      for (const pid of projectIds) {
        const p = await this.plugin.dataService.getProjectById(pid);
        projectNameMap.set(pid, p?.name ?? '已删除项目');
      }

      const categories = await this.plugin.categoryService.getAll();
      const service = new ImportExportService(this.plugin.app, this.plugin);
      const csv = await service.exportTodosToCSV(todos, categories, projectNameMap);

      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `todos_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      new Notice(`已导出 ${todos.length} 条待办`);
    } catch (e) {
      new Notice(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
