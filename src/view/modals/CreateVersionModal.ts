import { Modal, App as ObsidianApp, Setting } from 'obsidian';
import { createActionButtons } from '../ModalUtils';

export interface CreateVersionData {
  versionNumber: string;
  bllVersion: string;
  ippVersion: string;
  webVersion: string;
  updateContent: string;
}

export class CreateVersionModal extends Modal {
  onSubmit: (data: CreateVersionData) => void;

  constructor(app: ObsidianApp, onSubmit: (data: CreateVersionData) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');

    contentEl.createEl('h2', { text: '新建版本' });

    const data: CreateVersionData = {
      versionNumber: '',
      bllVersion: '',
      ippVersion: '',
      webVersion: '',
      updateContent: '',
    };

    new Setting(contentEl)
      .setName('APP版本号 *')
      .addText((text) => text.setPlaceholder('如: 1.0.0').onChange((value) => (data.versionNumber = value)));

    new Setting(contentEl).setName('BLL版本 *').addText((text) => text.onChange((value) => (data.bllVersion = value)));

    new Setting(contentEl).setName('IPP版本 *').addText((text) => text.onChange((value) => (data.ippVersion = value)));

    new Setting(contentEl).setName('Web版本 *').addText((text) => text.onChange((value) => (data.webVersion = value)));

    new Setting(contentEl)
      .setName('更新内容')
      .addTextArea((text) => text.setPlaceholder('可选').onChange((value) => (data.updateContent = value)));

    createActionButtons(contentEl, {
      confirmText: '创建',
      cancelText: '取消',
      onConfirm: () => {
        if (data.versionNumber && data.bllVersion && data.ippVersion && data.webVersion) {
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
