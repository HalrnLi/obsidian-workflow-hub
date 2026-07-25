import { Modal, App as ObsidianApp, Setting } from 'obsidian';
import { SavedFilter } from '../../types';

export class DeleteFilterModal extends Modal {
  filters: SavedFilter[];
  onSubmit: (filterId: string) => Promise<void>;
  onCloseCallback: () => void;

  constructor(app: ObsidianApp, filters: SavedFilter[], onSubmit: (filterId: string) => Promise<void>, onCloseCallback: () => void) {
    super(app);
    this.filters = filters;
    this.onSubmit = onSubmit;
    this.onCloseCallback = onCloseCallback;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');

    contentEl.createEl('h2', { text: '删除筛选条件' });

    this.filters.forEach((filter) => {
      new Setting(contentEl).setName(filter.name).addButton((btn) =>
        btn
          .setButtonText('删除')
          .setWarning()
          .onClick(() => {
            this.doDelete(filter.id);
          }),
      );
    });

    new Setting(contentEl).addButton((btn) => btn.setButtonText('关闭').onClick(() => this.close()));
  }

  private async doDelete(filterId: string) {
    const filter = this.filters.find((f) => f.id === filterId);
    if (!filter) return;

    this.filters = this.filters.filter((f) => f.id !== filterId);
    await this.onSubmit(filterId);

    if (this.filters.length === 0) {
      this.close();
    } else {
      this.contentEl.empty();
      this.onOpen();
    }
  }

  onClose() {
    this.contentEl.empty();
    setTimeout(() => {
      this.onCloseCallback();
    }, 100);
  }
}
