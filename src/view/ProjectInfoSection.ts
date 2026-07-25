import { ButtonComponent, Notice } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import { Project, ProjectInfoItem } from '../types';
import { openExternalLink } from '../utils/linkUtils';

/** 项目信息条目区组件（嵌入项目详情面板，属"项目备忘录"，非待办） */
export class ProjectInfoSection {
  constructor(
    private containerEl: HTMLElement,
    private plugin: AppVersionManagerPlugin,
    private project: Project,
    private onChange?: () => void,
  ) {}

  async render(): Promise<void> {
    this.containerEl.empty();
    const header = this.containerEl.createDiv({ cls: 'avm-section-header' });
    header.createEl('h4', { text: '项目信息' });
    new ButtonComponent(header)
      .setIcon('plus')
      .setButtonText('添加条目')
      .onClick(() => this.showForm(null));

    const list = this.containerEl.createDiv({ cls: 'avm-project-info-list' });
    const items = this.project.projectInfo ?? [];
    if (items.length === 0) {
      list.createDiv({ cls: 'avm-empty-state', text: '暂无信息条目，点击「添加条目」' });
      return;
    }

    items.forEach((item, index) => {
      const row = list.createDiv({ cls: 'avm-project-info-item' });
      row.createDiv({ cls: 'avm-project-info-desc', text: item.description });
      if (item.link) {
        const linkEl = row.createEl('a', { cls: 'avm-link', text: '🔗 链接', attr: { href: '#' } });
        linkEl.addEventListener('click', (e) => {
          e.preventDefault();
          openExternalLink(item.link);
        });
      }
      const actions = row.createDiv({ cls: 'avm-project-info-actions' });
      new ButtonComponent(actions)
        .setIcon('pencil')
        .setClass('avm-btn-icon')
        .setTooltip('编辑')
        .onClick(() => this.showForm({ index, item }));
      new ButtonComponent(actions)
        .setIcon('trash')
        .setClass('avm-btn-icon')
        .setTooltip('删除')
        .onClick(() => this.deleteItem(index));
    });
  }

  private async saveItems(items: ProjectInfoItem[]): Promise<void> {
    try {
      await this.plugin.dataService.updateProject(this.project.id, { projectInfo: items }, this.project.version);
      this.project.projectInfo = items;
      this.onChange?.();
      await this.render();
    } catch (e) {
      new Notice(e instanceof Error ? e.message : String(e));
    }
  }

  private showForm(edit: { index: number; item: ProjectInfoItem } | null): void {
    const formEl = this.containerEl.createDiv({ cls: 'avm-project-info-form' });
    const descInput = formEl.createEl('input', {
      cls: 'avm-search-input',
      attr: { placeholder: '条目描述' },
    });
    descInput.value = edit?.item.description ?? '';
    const linkInput = formEl.createEl('input', {
      cls: 'avm-search-input',
      attr: { placeholder: '链接（可选）' },
    });
    linkInput.value = edit?.item.link ?? '';
    const btns = formEl.createDiv({ cls: 'avm-filter-actions' });
    new ButtonComponent(btns)
      .setButtonText('保存')
      .setCta()
      .onClick(async () => {
        const description = descInput.value.trim();
        if (!description) {
          new Notice('请输入描述');
          return;
        }
        const link = linkInput.value.trim();
        const items = [...(this.project.projectInfo ?? [])];
        if (edit) {
          items[edit.index] = { description, link };
        } else {
          items.push({ description, link });
        }
        formEl.remove();
        await this.saveItems(items);
      });
    new ButtonComponent(btns).setButtonText('取消').onClick(() => formEl.remove());
  }

  private async deleteItem(index: number): Promise<void> {
    const items = [...(this.project.projectInfo ?? [])];
    items.splice(index, 1);
    await this.saveItems(items);
  }
}
