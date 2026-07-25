import { Modal, App as ObsidianApp, Setting } from 'obsidian';
import { Project, parseDateInput } from '../../types';
import { createSaveButtons } from '../ModalUtils';

export class TestPlanModal extends Modal {
  project: Project;
  onSubmit: (data: Partial<Project>) => void;

  constructor(app: ObsidianApp, project: Project, onSubmit: (data: Partial<Project>) => void) {
    super(app);
    this.project = project;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');

    contentEl.createEl('h2', { text: '提测计划配置' });

    const data = {
      b1IntegrationTestTime: this.project.b1IntegrationTestTime,
      b1SystemTestTime: this.project.b1SystemTestTime,
      b2IntegrationTestTime: this.project.b2IntegrationTestTime,
      b2SystemTestTime: this.project.b2SystemTestTime,
      b3IntegrationTestTime: this.project.b3IntegrationTestTime,
      b3SystemTestTime: this.project.b3SystemTestTime,
      b4IntegrationTestTime: this.project.b4IntegrationTestTime,
      b4SystemTestTime: this.project.b4SystemTestTime,
    };

    contentEl.createEl('h3', { text: 'B1阶段' });
    new Setting(contentEl).setName('B1集成测试时间').addText((text) =>
      text
        .setPlaceholder('YYYY-MM-DD 或其他格式')
        .setValue(data.b1IntegrationTestTime)
        .onChange((value) => (data.b1IntegrationTestTime = parseDateInput(value) || '')),
    );

    new Setting(contentEl).setName('B1系统测试时间').addText((text) =>
      text
        .setPlaceholder('YYYY-MM-DD 或其他格式')
        .setValue(data.b1SystemTestTime)
        .onChange((value) => (data.b1SystemTestTime = parseDateInput(value) || '')),
    );

    contentEl.createEl('h3', { text: 'B2阶段' });
    new Setting(contentEl).setName('B2集成测试时间').addText((text) =>
      text
        .setPlaceholder('YYYY-MM-DD 或其他格式')
        .setValue(data.b2IntegrationTestTime)
        .onChange((value) => (data.b2IntegrationTestTime = parseDateInput(value) || '')),
    );

    new Setting(contentEl).setName('B2系统测试时间').addText((text) =>
      text
        .setPlaceholder('YYYY-MM-DD 或其他格式')
        .setValue(data.b2SystemTestTime)
        .onChange((value) => (data.b2SystemTestTime = parseDateInput(value) || '')),
    );

    contentEl.createEl('h3', { text: 'B3阶段' });
    new Setting(contentEl).setName('B3集成测试时间').addText((text) =>
      text
        .setPlaceholder('YYYY-MM-DD 或其他格式')
        .setValue(data.b3IntegrationTestTime)
        .onChange((value) => (data.b3IntegrationTestTime = parseDateInput(value) || '')),
    );

    new Setting(contentEl).setName('B3系统测试时间').addText((text) =>
      text
        .setPlaceholder('YYYY-MM-DD 或其他格式')
        .setValue(data.b3SystemTestTime)
        .onChange((value) => (data.b3SystemTestTime = parseDateInput(value) || '')),
    );

    contentEl.createEl('h3', { text: 'B4阶段' });
    new Setting(contentEl).setName('B4集成测试时间').addText((text) =>
      text
        .setPlaceholder('YYYY-MM-DD 或其他格式')
        .setValue(data.b4IntegrationTestTime)
        .onChange((value) => (data.b4IntegrationTestTime = parseDateInput(value) || '')),
    );

    new Setting(contentEl).setName('B4系统测试时间').addText((text) =>
      text
        .setPlaceholder('YYYY-MM-DD 或其他格式')
        .setValue(data.b4SystemTestTime)
        .onChange((value) => (data.b4SystemTestTime = parseDateInput(value) || '')),
    );

    createSaveButtons(
      contentEl,
      () => {
        this.onSubmit(data);
        this.close();
      },
      () => this.close(),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
