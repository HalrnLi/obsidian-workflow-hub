import { Modal, App as ObsidianApp } from 'obsidian';
import { Project } from '../../types';
import { ProjectTodoSection } from '../ProjectTodoSection';
import AppVersionManagerPlugin from '../../main';

/** 项目待办编辑弹窗（独立入口，与提测计划同级） */
export class ProjectTodosModal extends Modal {
  private project: Project;
  private plugin: AppVersionManagerPlugin;
  private onSave?: () => void;

  constructor(app: ObsidianApp, plugin: AppVersionManagerPlugin, project: Project, onSave?: () => void) {
    super(app);
    this.plugin = plugin;
    this.project = project;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');

    contentEl.createEl('h2', { text: '项目待办' });
    contentEl.createEl('p', {
      text: `项目: ${this.project.name}`,
      cls: 'avm-test-plan-subtitle',
    });

    const sectionEl = contentEl.createDiv();
    new ProjectTodoSection(sectionEl, this.plugin, this.project, () => {
      this.onSave?.();
    }).render();
  }

  onClose() {
    this.contentEl.empty();
  }
}
