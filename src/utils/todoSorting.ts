import type { Todo } from '../types';
import { getPriorityWeight } from './todoUtils';

const STATUS_WEIGHT: Record<string, number> = {
  todo: 0,
  done: 1,
};

/**
 * 待办排序规则（默认排序）：
 * 1. 置顶：pinned 排在最前面
 * 2. 状态：todo > done（done 沉底）
 * 3. 优先级：high > medium > low > 无
 * 4. 截止日期：有 dueDate 的升序（早截止在前），无 dueDate 的在后
 * 5. 创建时间：升序（早创建在前）
 */
export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    // 1. 置顶优先
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

    // 2. 状态
    const sA = STATUS_WEIGHT[a.status] ?? 0;
    const sB = STATUS_WEIGHT[b.status] ?? 0;
    if (sA !== sB) return sA - sB;

    // 3. 优先级
    const pA = getPriorityWeight(a.priority);
    const pB = getPriorityWeight(b.priority);
    if (pA !== pB) return pA - pB;

    // 4. 截止日期（有 dueDate 的在前，升序）
    if (a.dueDate && b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;

    // 5. 创建时间升序
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}
