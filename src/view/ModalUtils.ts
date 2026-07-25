import { Setting } from 'obsidian';

export interface ActionButtonsOptions {
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => Promise<void> | void;
  onCancel?: () => void;
  isCta?: boolean;
}

/**
 * 创建统一的操作按钮（确定在左，取消在右）
 * @param container - 按钮容器元素
 * @param options - 按钮选项
 */
export function createActionButtons(container: HTMLElement, options: ActionButtonsOptions): void {
  const { confirmText = '确定', cancelText = '取消', onConfirm, onCancel, isCta = true } = options;

  new Setting(container)
    .addButton((button) => {
      const btn = button.setButtonText(confirmText);
      if (isCta) {
        btn.setCta();
      }
      btn.onClick(onConfirm);
      return btn;
    })
    .addButton((button) => button.setButtonText(cancelText).onClick(() => onCancel?.()));
}

/**
 * 创建保存/取消按钮（用于编辑模态框）
 */
export function createSaveButtons(container: HTMLElement, onSave: () => void, onCancel?: () => void): void {
  createActionButtons(container, {
    confirmText: '保存',
    cancelText: '取消',
    onConfirm: onSave,
    onCancel: onCancel,
  });
}
