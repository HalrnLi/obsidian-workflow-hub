import { Modal, App as ObsidianApp, Setting } from 'obsidian';
import { Version, Project, ProjectProgress, getProgressOrder, App, ProgressStage } from '../types';
import { createSaveButtons } from './ModalUtils';

export class EditProjectModal extends Modal {
  project: Project;
  onSubmit: (data: Partial<Project>) => void;
  apps: App[];
  versions: Version[];
  progressStages: ProgressStage[];
  responsiblePersons: string[];
  versionLabelFn?: (v: Version, app?: App) => string;

  constructor(
    app: ObsidianApp,
    project: Project,
    apps: App[],
    versions: Version[],
    progressStages: ProgressStage[],
    responsiblePersons: string[],
    onSubmit: (data: Partial<Project>) => void,
    options?: { versionLabelFn?: (v: Version, app?: App) => string },
  ) {
    super(app);
    this.project = project;
    this.apps = apps;
    this.versions = versions;
    this.progressStages = progressStages;
    this.responsiblePersons = responsiblePersons;
    this.onSubmit = onSubmit;
    this.versionLabelFn = options?.versionLabelFn;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');

    contentEl.createEl('h2', { text: '编辑项目' });

    const data = {
      name: this.project.name,
      versionId: this.project.versionId,
      manager: this.project.manager,
      responsiblePerson: this.project.responsiblePerson,
      projectLink: this.project.projectLink,
      componentLink: this.project.componentLink,
      features: this.project.features,
      spec: this.project.spec,
      requirements: this.project.requirements,
      progress: this.project.progress,
    };

    new Setting(contentEl).setName('项目名称 *').addText((text) => text.setValue(data.name).onChange((value) => (data.name = value)));

    new Setting(contentEl).setName('所属版本').addDropdown((dropdown) => {
      this.versions.forEach((version) => {
        const app = this.apps.find((a) => a.id === version.appId);
        const label = this.versionLabelFn ? this.versionLabelFn(version, app) : version.versionNumber;
        dropdown.addOption(version.id, label);
      });
      if (data.versionId) {
        dropdown.setValue(data.versionId);
      }
      dropdown.onChange((value) => (data.versionId = value));
    });

    new Setting(contentEl).setName('项目经理').addText((text) => text.setValue(data.manager).onChange((value) => (data.manager = value)));

    // 负责人下拉选择，从插件配置中读取可选列表
    new Setting(contentEl).setName('负责人').addDropdown((dropdown) => {
      dropdown.addOption('', '无');
      this.responsiblePersons.forEach((person) => {
        dropdown.addOption(person, person);
      });
      // 若当前值不在配置列表中（如已被删除），仍保留该选项以便显示
      if (data.responsiblePerson && !this.responsiblePersons.includes(data.responsiblePerson)) {
        dropdown.addOption(data.responsiblePerson, `${data.responsiblePerson} (已删除)`);
      }
      dropdown.setValue(data.responsiblePerson);
      dropdown.onChange((value) => (data.responsiblePerson = value));
    });

    new Setting(contentEl)
      .setName('项目链接')
      .addText((text) => text.setValue(data.projectLink).onChange((value) => (data.projectLink = value)));

    new Setting(contentEl)
      .setName('组件库链接')
      .addText((text) => text.setValue(data.componentLink).onChange((value) => (data.componentLink = value)));

    new Setting(contentEl).setName('项目进度').addDropdown((dropdown) => {
      const progressOrder = getProgressOrder(this.progressStages);
      progressOrder.forEach((progress) => {
        dropdown.addOption(progress, progress);
      });
      dropdown.setValue(data.progress);
      dropdown.onChange((value) => (data.progress = value as ProjectProgress));
    });

    new Setting(contentEl).setName('特性').addTextArea((text) => text.setValue(data.features).onChange((value) => (data.features = value)));

    new Setting(contentEl)
      .setName('配置组件/规格')
      .addTextArea((text) => text.setValue(data.spec).onChange((value) => (data.spec = value)));

    new Setting(contentEl)
      .setName('项目需求')
      .addTextArea((text) => text.setValue(data.requirements).onChange((value) => (data.requirements = value)));

    // 提测计划时间入口按钮
    createSaveButtons(
      contentEl,
      () => {
        if (data.name && data.versionId) {
          this.onSubmit(data);
          this.close();
        }
      },
      () => this.close(),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
