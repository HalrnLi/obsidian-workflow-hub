import { Modal, App as ObsidianApp, Setting, Notice } from 'obsidian';
import AppVersionManagerPlugin from '../../main';
import { Todo, TodoPriority, TodoStatus, Category } from '../../types';
import { createActionButtons } from '../ModalUtils';

export interface CreateTodoData {
  content: string;
  link: string;
  dueDate: string;
  priority: TodoPriority;
  status: TodoStatus;
  categoryId: string | null;
  projectId: string | null;
  responsiblePerson: string;
}

/** 创建/编辑待办弹窗 */
export class CreateTodoModal extends Modal {
  private plugin: AppVersionManagerPlugin;
  private onSubmit: (data: CreateTodoData) => void;
  private existing: Todo | null;
  private lockProject: boolean;
  private defaultProjectId: string | null;

  private data: CreateTodoData;
  private categories: Category[] = [];

  constructor(
    app: ObsidianApp,
    plugin: AppVersionManagerPlugin,
    onSubmit: (data: CreateTodoData) => void,
    existing: Todo | null = null,
    options?: { lockProject?: boolean; defaultProjectId?: string | null },
  ) {
    super(app);
    this.plugin = plugin;
    this.onSubmit = onSubmit;
    this.existing = existing;
    this.lockProject = options?.lockProject ?? false;
    this.defaultProjectId = options?.defaultProjectId ?? null;
    this.data = {
      content: existing?.content ?? '',
      link: existing?.link ?? '',
      dueDate: existing?.dueDate ?? '',
      priority: existing?.priority ?? '',
      status: existing?.status ?? 'todo',
      categoryId: existing?.categoryId ?? plugin.dataConfigService.config.defaultCategoryId ?? null,
      projectId: existing?.projectId ?? this.defaultProjectId ?? null,
      responsiblePerson: existing?.responsiblePerson ?? plugin.todoService.getCurrentResponsiblePerson() ?? '',
    };
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');
    contentEl.createEl('h2', { text: this.existing ? '编辑待办' : '新建待办' });

    try {
      this.categories = await this.plugin.categoryService.getAll();
    } catch (e) {
      console.error('加载分类失败', e);
    }

    new Setting(contentEl).setName('内容').addTextArea((text) =>
      text
        .setPlaceholder('待办内容（可含 #tag）')
        .setValue(this.data.content)
        .onChange((v) => (this.data.content = v)),
    );

    // 负责人（只读显示，由顶部选择器决定）
    if (this.data.responsiblePerson) {
      const personSetting = new Setting(contentEl).setName('负责人');
      personSetting.descEl.setText(this.data.responsiblePerson);
    }

    new Setting(contentEl).setName('链接').addText((text) =>
      text
        .setPlaceholder('https://...')
        .setValue(this.data.link)
        .onChange((v) => (this.data.link = v)),
    );

    new Setting(contentEl).setName('截止日期').addText((text) =>
      text
        .setPlaceholder('YYYY-MM-DD')
        .setValue(this.data.dueDate)
        .onChange((v) => (this.data.dueDate = v)),
    );

    new Setting(contentEl).setName('优先级').addDropdown((dd) => {
      dd.addOption('', '无');
      dd.addOption('high', '高');
      dd.addOption('medium', '中');
      dd.addOption('low', '低');
      dd.setValue(this.data.priority);
      dd.onChange((v) => (this.data.priority = v as TodoPriority));
    });

    new Setting(contentEl).setName('分类').addDropdown((dd) => {
      dd.addOption('', '未分类');
      this.categories.forEach((c) => {
        dd.addOption(c.id, c.name);
        // 设置选项颜色（下拉选中后显示）
        const opt = dd.selectEl.querySelector(`option[value="${c.id}"]`) as HTMLOptionElement | null;
        if (opt && c.color) {
          opt.style.borderLeft = `3px solid ${c.color}`;
        }
      });
      dd.setValue(this.data.categoryId ?? '');
      dd.onChange((v) => (this.data.categoryId = v ? v : null));
    });

    createActionButtons(contentEl, {
      confirmText: this.existing ? '保存' : '创建',
      cancelText: '取消',
      onConfirm: () => {
        if (!this.data.content.trim()) {
          new Notice('请输入待办内容');
          return;
        }
        this.data.content = this.data.content.trim();
        this.onSubmit(this.data);
        this.close();
      },
      onCancel: () => this.close(),
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
