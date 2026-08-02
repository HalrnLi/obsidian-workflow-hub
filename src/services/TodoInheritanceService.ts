import AppVersionManagerPlugin from '../main';
import { Todo } from '../types';
import { todayStr, nowISO } from '../utils/dateUtils';

/**
 * 待办智能继承服务。
 *
 * 功能：将历史未完成的待办自动"移动"到今天（更新 createdAt 为今天）。
 * 触发时机：
 *   1. 插件 onLayoutReady 时执行一次
 *   2. 每天凌晨 1 点自动执行
 *
 * 避免重复：记录最后执行日期到 settings.inheritanceLastRun，同一天不重复执行。
 */
export class TodoInheritanceService {
  private plugin: AppVersionManagerPlugin;
  private scheduleTimer: number | null = null;

  constructor(plugin: AppVersionManagerPlugin) {
    this.plugin = plugin;
  }

  /** 启动定时调度（计算到下一个凌晨 1:00 的 ms 数） */
  start(): void {
    this.clear();
    const now = new Date();
    const next1AM = new Date(now);
    next1AM.setHours(1, 0, 0, 0);
    if (next1AM.getTime() <= now.getTime()) {
      next1AM.setDate(next1AM.getDate() + 1);
    }
    const delay = next1AM.getTime() - now.getTime();

    this.scheduleTimer = window.setTimeout(() => {
      this.runInheritance().catch((e) => {
        console.error('[WorkflowHub] 智能继承失败:', e);
      });
      // 重新调度下一个 24h
      this.scheduleTimer = window.setInterval(
        () => {
          this.runInheritance().catch((e) => {
            console.error('[WorkflowHub] 智能继承失败:', e);
          });
        },
        24 * 60 * 60 * 1000,
      );
    }, delay);

    // 启动时检查一次（如果今天还没执行过）
    this.runInheritance().catch((e) => {
      console.error('[WorkflowHub] 智能继承失败:', e);
    });
  }

  clear(): void {
    if (this.scheduleTimer !== null) {
      window.clearTimeout(this.scheduleTimer);
      window.clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  /** 执行智能继承：将历史未完成待办的 updatedAt 更新为现在（不修改 createdAt） */
  async runInheritance(): Promise<number> {
    const today = todayStr();
    const lastRun = this.plugin.settings.inheritanceLastRun;

    // 今天已执行过，跳过
    if (lastRun === today) {
      return 0;
    }

    // 继承是全局行为，需绕过全局负责人筛选
    const todos = await this.plugin.todoService.getAllTodosBypassFilter();
    const pending = todos.filter((t) => t.status !== 'done' && t.createdAt.slice(0, 10) < today);

    const now = nowISO();
    for (const todo of pending) {
      await this.plugin.todoService.update(todo.id, { updatedAt: now });
    }

    this.plugin.settings.inheritanceLastRun = today;
    await this.plugin.saveSettings();

    if (pending.length > 0) {
      console.log(`[WorkflowHub] 智能继承: ${pending.length} 条待办已更新更新时间`);
    }

    return pending.length;
  }
}
