import { Modal, Setting, ButtonComponent, App as ObsidianApp } from 'obsidian';
import { createActionButtons } from './ModalUtils';

export class ConfirmModal extends Modal {
  private titleText: string;
  private messageText: string;
  private onConfirmCallback: () => Promise<void> | void;
  private onCancelCallback?: () => void;
  private danger: boolean;

  constructor(
    app: ObsidianApp,
    titleText: string,
    messageText: string,
    onConfirmCallback: () => Promise<void> | void,
    onCancelCallback?: () => void,
    danger: boolean = false,
  ) {
    super(app);
    this.titleText = titleText;
    this.messageText = messageText;
    this.onConfirmCallback = onConfirmCallback;
    this.onCancelCallback = onCancelCallback;
    this.danger = danger;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');

    contentEl.createEl('h2', { text: this.titleText });
    contentEl.createEl('p', { text: this.messageText });

    new Setting(contentEl)
      .addButton((btn: ButtonComponent) => {
        const button = btn.setButtonText('确定');
        if (this.danger) {
          button.setWarning();
        } else {
          button.setCta();
        }
        button.onClick(async () => {
          try {
            await this.onConfirmCallback();
          } finally {
            this.close();
          }
        });
        return btn;
      })
      .addButton((btn: ButtonComponent) =>
        btn.setButtonText('取消').onClick(() => {
          this.close();
          this.onCancelCallback?.();
        }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
