import { Modal, App as ObsidianApp, Setting } from 'obsidian';
import { createActionButtons } from '../ModalUtils';

export class CreateAppModal extends Modal {
  onSubmit: (name: string) => void;

  constructor(app: ObsidianApp, onSubmit: (name: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');

    contentEl.createEl('h2', { text: '新建APP' });

    let appName = '';

    new Setting(contentEl).setName('APP名称').addText((text) => text.setPlaceholder('输入APP名称').onChange((value) => (appName = value)));

    createActionButtons(contentEl, {
      confirmText: '创建',
      cancelText: '取消',
      onConfirm: () => {
        if (appName.trim()) {
          this.onSubmit(appName.trim());
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
