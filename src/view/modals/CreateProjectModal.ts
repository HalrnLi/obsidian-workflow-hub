import { Modal, App as ObsidianApp, Setting } from 'obsidian';
import {
  ProjectLink,
  ProjectProgress,
  ProgressStage,
  getProgressOrder,
  getFirstProgress,
  App,
  Version,
} from '../../types';
import { createActionButtons } from '../ModalUtils';
import { AppVersionLinksEditor } from '../components/AppVersionLinksEditor';

export interface CreateProjectData {
  name: string;
  appVersionLinks: ProjectLink[];
  manager: string;
  responsiblePerson: string;
  projectLink: string;
  componentLink: string;
  features: string;
  spec: string;
  requirements: string;
  progress: ProjectProgress;
}

export class CreateProjectModal extends Modal {
  apps: App[];
  versions: Version[];
  progressStages: ProgressStage[];
  responsiblePersons: string[];
  onSubmit: (data: CreateProjectData) => void;

  constructor(
    app: ObsidianApp,
    apps: App[],
    versions: Version[],
    progressStages: ProgressStage[],
    responsiblePersons: string[],
    onSubmit: (data: CreateProjectData) => void,
  ) {
    super(app);
    this.apps = apps;
    this.versions = versions;
    this.progressStages = progressStages;
    this.responsiblePersons = responsiblePersons;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');

    contentEl.createEl('h2', { text: '新建项目' });

    const firstProgress = getFirstProgress(this.progressStages);
    const data: CreateProjectData = {
      name: '',
      appVersionLinks: [],
      manager: '',
      responsiblePerson: '',
      projectLink: '',
      componentLink: '',
      features: '',
      spec: '',
      requirements: '',
      progress: firstProgress,
    };

    new Setting(contentEl)
      .setName('项目名称 *')
      .addText((text) => text.setPlaceholder('输入项目名称').onChange((value) => (data.name = value)));

    // APP/版本关联（可选）
    const linksContainer = contentEl.createDiv({ cls: 'avm-links-editor-container' });
    new AppVersionLinksEditor(linksContainer, this.apps, this.versions, data.appVersionLinks);

    new Setting(contentEl).setName('项目经理').addText((text) => text.onChange((value) => (data.manager = value)));

    // 负责人下拉选择
    new Setting(contentEl).setName('负责人').addDropdown((dropdown) => {
      dropdown.addOption('', '无');
      this.responsiblePersons.forEach((person) => {
        dropdown.addOption(person, person);
      });
      dropdown.setValue(data.responsiblePerson);
      dropdown.onChange((value) => (data.responsiblePerson = value));
    });

    new Setting(contentEl)
      .setName('项目链接')
      .addText((text) => text.setPlaceholder('https://...').onChange((value) => (data.projectLink = value)));

    new Setting(contentEl)
      .setName('组件库链接')
      .addText((text) => text.setPlaceholder('https://...').onChange((value) => (data.componentLink = value)));

    new Setting(contentEl).setName('项目进度').addDropdown((dropdown) => {
      const progressOrder = getProgressOrder(this.progressStages);
      progressOrder.forEach((progress) => {
        dropdown.addOption(progress, progress);
      });
      dropdown.setValue(data.progress);
      dropdown.onChange((value) => (data.progress = value as ProjectProgress));
    });

    new Setting(contentEl)
      .setName('特性')
      .addTextArea((text) => text.setPlaceholder('可选').onChange((value) => (data.features = value)));

    new Setting(contentEl)
      .setName('配置组件/规格')
      .addTextArea((text) => text.setPlaceholder('可选').onChange((value) => (data.spec = value)));

    new Setting(contentEl)
      .setName('项目需求')
      .addTextArea((text) => text.setPlaceholder('可选').onChange((value) => (data.requirements = value)));

    createActionButtons(contentEl, {
      confirmText: '创建',
      cancelText: '取消',
      onConfirm: () => {
        if (data.name) {
          this.onSubmit(data);
          this.close();
        }
      },
      onCancel: () => this.close(),
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
