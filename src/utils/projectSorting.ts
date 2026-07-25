import { Project, getProgressOrder, getLastProgress, getNextStageInfo, ProgressStage } from '../types';

export interface SortableProject {
  project: Project;
  priority: number;
  sortTime: number;
}

export interface OverdueStats {
  overdue: number; // 已延期（超过截止日期）
  warning: number; // 即将到期（预警天数内）
  onTrack: number; // 正常
}

export function calculateOverdueStats(projects: Project[], stages: ProgressStage[], warningDays: number = 3): OverdueStats {
  const stats: OverdueStats = { overdue: 0, warning: 0, onTrack: 0 };
  const lastProgress = getLastProgress(stages);

  for (const project of projects) {
    // 已完成的项目不计入
    if (project.progress === lastProgress) continue;

    const nextStageInfo = getNextStageInfo(project);
    if (!nextStageInfo.time) {
      stats.onTrack++;
      continue;
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const nextDate = new Date(nextStageInfo.time);
    nextDate.setHours(0, 0, 0, 0);

    const diffDays = Math.floor((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      stats.overdue++;
    } else if (diffDays <= warningDays) {
      stats.warning++;
    } else {
      stats.onTrack++;
    }
  }

  return stats;
}

export function sortProjectsByPriority(projects: Project[], stages: ProgressStage[]): Project[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const lastProgress = getLastProgress(stages);
  const progressOrder = getProgressOrder(stages);

  const projectsWithPriority = projects.map((project) => {
    const nextStageInfo = getNextStageInfo(project);

    let priority = 4;
    let sortTime: number;

    if (project.progress === lastProgress) {
      priority = 5;
      sortTime = Number.MAX_SAFE_INTEGER;
    } else if (nextStageInfo.time) {
      const nextDate = new Date(nextStageInfo.time);
      nextDate.setHours(0, 0, 0, 0);

      const daysDiff = Math.floor((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff === 0) {
        priority = 1;
      } else if (daysDiff === 1) {
        priority = 2;
      } else if (daysDiff > 1) {
        priority = 3;
      } else {
        priority = 4;
      }

      sortTime = nextDate.getTime();
    } else {
      priority = 4;
      const progressIndex = progressOrder.indexOf(project.progress);
      sortTime = progressIndex >= 0 ? progressIndex : Number.MAX_SAFE_INTEGER;
    }

    return { project, priority, sortTime };
  });

  return projectsWithPriority
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.sortTime - b.sortTime;
    })
    .map((item) => item.project);
}

export function isProjectHighlighted(project: Project, warningDays: number = 3): boolean {
  const nextStageInfo = getNextStageInfo(project);
  if (!nextStageInfo.time) return false;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const nextDate = new Date(nextStageInfo.time);
  nextDate.setHours(0, 0, 0, 0);

  const daysDiff = Math.floor((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return daysDiff <= warningDays && daysDiff >= 0;
}

export function checkOverdue(project: Project, stages: ProgressStage[], warningDays: number = 3): boolean {
  const progressOrder = getProgressOrder(stages);
  const lastTwoProgresses = progressOrder.slice(-2);

  if (lastTwoProgresses.includes(project.progress)) return false;

  const nextStageInfo = getNextStageInfo(project);
  if (!nextStageInfo.time) return false;

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const nextDate = new Date(nextStageInfo.time);
  nextDate.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  // 延期：已超过截止日期（diffDays < 0）
  // 或在预警期内（diffDays >= 0 && diffDays <= warningDays）
  return diffDays < 0 || (diffDays >= 0 && diffDays <= warningDays);
}
