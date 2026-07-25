import { Modal, App as ObsidianApp, Setting } from 'obsidian';
import { createSaveButtons } from '../ModalUtils';

export class RenameAppModal extends Modal {
  currentName: string;
  onSubmit: (newName: string) => void;

  constructor(app: ObsidianApp, currentName: string, onSubmit: (newName: string) => void) {
    super(app);
    this.currentName = currentName;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');

    contentEl.createEl('h2', { text: '重命名APP' });

    let newName = this.currentName;

    new Setting(contentEl)
      .setName('APP名称')
      .addText((text) => text.setValue(this.currentName).onChange((value) => (newName = value)));

    createSaveButtons(
      contentEl,
      () => {
        if (newName.trim() && newName !== this.currentName) {
          this.onSubmit(newName.trim());
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
