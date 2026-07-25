import AppVersionManagerPlugin from '../main';

interface Reminder {
  timerId: number;
  fireAt: number;
  todoId: string;
  content: string;
  link: string;
}

/**
 * 倒计时提醒服务（参考 todolist ReminderService）。
 * 基于待办截止日期设置定时提醒，到期时弹出通知。
 */
export class ReminderService {
  private plugin: AppVersionManagerPlugin;
  private reminders = new Map<string, Reminder>();
  private _visibilityHandler: (() => void) | null = null;

  constructor(plugin: AppVersionManagerPlugin) {
    this.plugin = plugin;
    this._setupVisibilityFallback();
  }

  /**
   * 设置提醒
   * @param todoId 待办 ID
   * @param content 提醒内容
   * @param delayMs 延迟毫秒数
   * @param link 关联链接
   * @returns fireAt 时间戳
   */
  setReminder(todoId: string, content: string, delayMs: number, link: string): number {
    this.cancelReminder(todoId);

    const fireAt = Date.now() + delayMs;
    const timerId = window.setTimeout(() => {
      try {
        // 检查待办是否已完成
        this.plugin.todoService
          .getById(todoId)
          .then((todo) => {
            if (todo && todo.status === 'done') return;
            this._notify(content, link);
          })
          .catch(() => {
            this._notify(content, link);
          });
      } finally {
        this.reminders.delete(todoId);
        this.plugin.notifyViewsToRefresh();
      }
    }, delayMs);

    this.reminders.set(todoId, { timerId, fireAt, todoId, content, link });
    return fireAt;
  }

  /**
   * 更新提醒内容（不重置定时器）
   */
  updateReminderContent(todoId: string, content: string, link: string): void {
    const reminder = this.reminders.get(todoId);
    if (reminder) {
      reminder.content = content;
      reminder.link = link;
    }
  }

  /**
   * 取消提醒
   */
  cancelReminder(todoId: string): boolean {
    const reminder = this.reminders.get(todoId);
    if (!reminder) return false;
    window.clearTimeout(reminder.timerId);
    this.reminders.delete(todoId);
    return true;
  }

  /**
   * 是否有提醒
   */
  hasReminder(todoId: string): boolean {
    return this.reminders.has(todoId);
  }

  /**
   * 返回剩余毫秒数
   */
  getRemainingTime(todoId: string): number {
    const reminder = this.reminders.get(todoId);
    if (!reminder) return 0;
    return Math.max(0, reminder.fireAt - Date.now());
  }

  /**
   * 清除所有提醒
   */
  clearAll(): void {
    for (const reminder of this.reminders.values()) {
      window.clearTimeout(reminder.timerId);
    }
    this.reminders.clear();
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  /**
   * 页面从后台恢复时，检查是否有错过的提醒
   */
  private _setupVisibilityFallback(): void {
    this._visibilityHandler = () => {
      if (document.hidden) return;
      const now = Date.now();
      for (const [todoId, reminder] of this.reminders) {
        if (reminder.fireAt <= now) {
          window.clearTimeout(reminder.timerId);
          this.reminders.delete(todoId);
          this.plugin.todoService
            .getById(todoId)
            .then((todo) => {
              if (todo && todo.status === 'done') return;
              this._notify(reminder.content, reminder.link);
            })
            .catch(() => {
              this._notify(reminder.content, reminder.link);
            });
        }
      }
      this.plugin.notifyViewsToRefresh();
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  /**
   * 触发通知
   */
  private _notify(content: string, link: string): void {
    const safeLink = this._sanitizeLink(link);
    this._showToast(content, safeLink);
  }

  private _sanitizeLink(link: string): string | null {
    if (!link || typeof link !== 'string') return null;
    const trimmed = link.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return null;
  }

  private _showToast(content: string, safeLink: string | null): void {
    // 确保有通知容器
    let container = document.querySelector('.avm-toast-container') as HTMLElement | null;
    if (!container) {
      container = document.createElement('div');
      container.className = 'avm-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'avm-toast';

    const icon = document.createElement('span');
    icon.textContent = '⏰';
    icon.className = 'avm-toast-icon';

    const text = document.createElement('span');
    text.textContent = content;
    text.className = 'avm-toast-text';

    const hint = document.createElement('span');
    hint.className = 'avm-toast-hint';
    hint.textContent = safeLink ? '点击打开链接' : '点击关闭';

    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(hint);

    toast.addEventListener('click', () => {
      if (safeLink) window.open(safeLink, '_blank', 'noopener,noreferrer');
      toast.remove();
      const c = document.querySelector('.avm-toast-container');
      if (c && !c.firstChild) c.remove();
    });

    container.insertBefore(toast, container.firstChild);
  }
}
