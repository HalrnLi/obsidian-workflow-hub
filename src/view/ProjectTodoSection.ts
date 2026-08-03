import { ButtonComponent, Notice, Menu } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import { Todo, TodoStatus, Project } from '../types';
import { sortTodos } from '../utils/todoSorting';
import { getPriorityConfig, isOverdueTask, isUrgentTask } from '../utils/todoUtils';
import { CreateTodoModal, CreateTodoData } from './modals/CreateTodoModal';
import { ConfirmModal } from './ConfirmModal';
import { openExternalLink } from '../utils/linkUtils';

/** 项目待办区组件（替代原 TodoSidePanel，嵌入项目详情面板） */
export class ProjectTodoSection {
  constructor(
    private containerEl: HTMLElement,
    private plugin: AppVersionManagerPlugin,
    private project: Pick<Project, 'id' | 'name' | 'responsiblePerson'>,
    private onChange?: () => void,
  ) {}

  async render(): Promise<void> {
    this.containerEl.empty();
    const header = this.containerEl.createDiv({ cls: 'avm-section-header' });
    header.createEl('h4', { text: '项目待办' });
    new ButtonComponent(header)
      .setIcon('plus')
      .setButtonText('添加待办')
      .onClick(() => this.showCreate());

    const listEl = this.containerEl.createDiv({ cls: 'avm-todo-list' });

    let todos: Todo[] = [];
    try {
      todos = sortTodos(await this.plugin.todoService.getTodosByProject(this.project.id));
    } catch (e) {
      console.error('加载项目待办失败', e);
    }

    if (todos.length === 0) {
      listEl.createDiv({ cls: 'avm-empty-state', text: '暂无待办' });
      return;
    }

    const completed = todos.filter((t) => t.status === 'done').length;
    const statsEl = this.containerEl.createDiv({
      cls: 'avm-todo-stats',
      text: `已完成 ${completed} / 共 ${todos.length}`,
    });

    todos.forEach((todo) => this.renderTodoItem(listEl, todo));
  }

  private renderTodoItem(listEl: HTMLElement, todo: Todo): void {
    const item = listEl.createDiv({
      cls: 'avm-todo-item' + (todo.status === 'done' ? ' avm-todo-done' : '') + (todo.pinned ? ' avm-todo-pinned' : ''),
    });

    // 状态切换图标（todo ↔ done）
    const icon = item.createSpan({ cls: 'avm-todo-status-icon' });
    icon.setText(todo.status === 'done' ? '◼️' : '◻️');
    icon.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        // 切换：todo ↔ done
        const next: TodoStatus = todo.status === 'done' ? 'todo' : 'done';
        await this.plugin.todoService.update(todo.id, { status: next });
        await this.render();
        this.onChange?.();
      } catch (err) {
        new Notice(err instanceof Error ? err.message : String(err));
      }
    });

    // 优先级徽章
    const pc = getPriorityConfig(todo.priority);
    if (pc) {
      const badge = item.createSpan({ cls: 'avm-priority-badge', text: pc.label });
      badge.style.backgroundColor = pc.color;
    }

    // 内容
    const content = item.createSpan({ cls: 'avm-todo-content', text: todo.content });

    // 双击打开编辑弹窗
    item.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showEdit(todo);
    });

    // 截止日期
    if (todo.dueDate) {
      const due = item.createSpan({ cls: 'avm-todo-due', text: `📅 ${todo.dueDate}` });
      if (isOverdueTask(todo)) due.addClass('avm-overdue-text');
      else if (isUrgentTask(todo)) due.addClass('avm-urgent-text');
    }

    // 链接
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
          this.onChange?.();
        }),
      );
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

  private async setStatus(todo: Todo, status: TodoStatus): Promise<void> {
    try {
      await this.plugin.todoService.update(todo.id, { status });
      await this.render();
      this.onChange?.();
    } catch (e) {
      new Notice(e instanceof Error ? e.message : String(e));
    }
  }

  private showCreate(): void {
    new CreateTodoModal(
      this.plugin.app,
      this.plugin,
      async (data: CreateTodoData) => {
        try {
          await this.plugin.todoService.create({ ...data, projectId: this.project.id });
          await this.render();
          this.onChange?.();
        } catch (e) {
          new Notice(e instanceof Error ? e.message : String(e));
        }
      },
      null,
      {
        lockProject: true,
        defaultProjectId: this.project.id,
        // 项目无负责人时传 undefined，让弹窗回退到当前选中的负责人
        defaultResponsiblePerson: this.project.responsiblePerson || undefined,
      },
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
          this.onChange?.();
        } catch (e) {
          new Notice(e instanceof Error ? e.message : String(e));
        }
      },
      todo,
      { lockProject: true },
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
          this.onChange?.();
        } catch (e) {
          new Notice(e instanceof Error ? e.message : String(e));
        }
      },
      undefined,
      true,
    ).open();
  }
}
