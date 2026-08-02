import type { Todo } from '../types';
import { parseLocalDate, todayStart } from './dateUtils';

/**
 * 待办工具函数（从 todolist models.js 迁移并 TS 重写）。
 * 保留原 #tag 解析逻辑用于显示/搜索辅助，但新系统不把 #tag 当分类用。
 */

/** 优先级配置（配色 + 排序权重），来自 todolist models.js PRIORITY */
export const PRIORITY_CONFIG: Record<string, { label: string; color: string; weight: number }> = {
  high: { label: '高', color: '#ef4444', weight: 0 },
  medium: { label: '中', color: '#f59e0b', weight: 1 },
  low: { label: '低', color: '#10b981', weight: 2 },
};

/** 空优先级权重（沉底） */
export const NO_PRIORITY_WEIGHT = 3;

/** 获取优先级权重（用于排序，越小越靠前） */
export function getPriorityWeight(priority: string): number {
  return PRIORITY_CONFIG[priority]?.weight ?? NO_PRIORITY_WEIGHT;
}

/** 获取优先级配置（用于 UI 配色） */
export function getPriorityConfig(priority: string): { label: string; color: string } | null {
  return PRIORITY_CONFIG[priority] ?? null;
}

/** 解析 content 中的 #tag（保留原文，仅用于显示/搜索辅助，不持久化为分类） */
export function parseTags(content: string): string[] {
  if (!content) return [];
  const matches = content.match(/#[\w\u4e00-\u9fa5\-_]+/g);
  return matches ? matches.map((t) => t.slice(1)) : [];
}

/** 移除 content 中的 #tag（返回纯文本，原 content 不变） */
export function removeTags(content: string): string {
  if (!content) return '';
  return content
    .replace(/#[\w\u4e00-\u9fa5\-_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 判断待办是否紧急（截止日期临近且未完成） */
export function isUrgentTask(todo: Todo, warningDays = 3): boolean {
  if (todo.status === 'done' || !todo.dueDate) return false;
  const today = todayStart();
  const due = parseLocalDate(todo.dueDate);
  const diff = (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return diff <= warningDays && diff >= 0;
}

/** 判断待办是否已过期（截止日期已过且未完成） */
export function isOverdueTask(todo: Todo): boolean {
  if (todo.status === 'done' || !todo.dueDate) return false;
  const today = todayStart();
  const due = parseLocalDate(todo.dueDate);
  return due < today;
}

/** 判断待办是否未完成（todo） */
export function isTodoActive(todo: Todo): boolean {
  return todo.status !== 'done';
}
