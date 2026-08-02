import { parseLocalDate, todayStart } from './utils/dateUtils';

export class ConcurrencyConflictError extends Error {
  constructor(
    public entityName: string,
    public currentVersion: number,
    public expectedVersion: number,
  ) {
    super(`并发冲突：${entityName} 已被其他用户修改。当前版本: ${currentVersion}，期望版本: ${expectedVersion}`);
    this.name = 'ConcurrencyConflictError';
  }
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

export type ProjectProgress = string;

export interface ProgressStage {
  name: string;
  color: string;
}

export const DEFAULT_PROGRESS_STAGES: ProgressStage[] = [
  { name: '需求分解', color: '#6366f1' },
  { name: '配置组件填写', color: '#8b5cf6' },
  { name: '组件上传', color: '#ec4899' },
  { name: '自测验证', color: '#f59e0b' },
  { name: '待提测', color: '#f97316' },
  { name: '已提测', color: '#3b82f6' },
  { name: '已发布', color: '#10b981' },
];

/** 项目关联的 APP+版本对（一个项目可关联多个 APP，每个 APP 对应一个版本） */
export interface ProjectLink {
  appId: string;
  versionId: string;
}

export interface Project {
  id: string;
  name: string;
  /** 项目关联的 APP+版本列表（为空表示未关联任何 APP） */
  appVersionLinks: ProjectLink[];
  manager: string;
  responsiblePerson: string;
  projectLink: string;
  componentLink: string;
  features: string;
  spec: string;
  requirements: string;
  progress: ProjectProgress;
  progressHistory: ProgressHistoryItem[];
  // 提测计划时间
  b1IntegrationTestTime: string;
  b1SystemTestTime: string;
  b2IntegrationTestTime: string;
  b2SystemTestTime: string;
  b3IntegrationTestTime: string;
  b3SystemTestTime: string;
  b4IntegrationTestTime: string;
  b4SystemTestTime: string;
  actualReleaseTime: string;
  /** 项目信息条目区（项目备忘录：描述+可选链接），非待办 */
  projectInfo: ProjectInfoItem[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** 项目信息条目（嵌入 Project.frontmatter.projectInfo 数组） */
export interface ProjectInfoItem {
  description: string;
  link: string;
}

export interface ProgressHistoryItem {
  progress: ProjectProgress;
  changedAt: string;
}

export interface Version {
  id: string;
  appId: string;
  versionNumber: string;
  bllVersion: string;
  ippVersion: string;
  webVersion: string;
  updateContent: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface App {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** 待办状态机：待完成 / 已完成 */
export type TodoStatus = 'todo' | 'done';

/** 待办优先级：高 / 中 / 低 / 无（空字符串） */
export type TodoPriority = 'high' | 'medium' | 'low' | '';

export interface Todo {
  id: string;
  content: string;
  link: string;
  dueDate: string;
  /** 优先级（空字符串=无优先级，统一空值约定） */
  priority: TodoPriority;
  /** 状态机（替代 completed: boolean） */
  status: TodoStatus;
  /** 是否置顶（置顶的待办排在最前面） */
  pinned: boolean;
  /** 所属分类 ID（null=未分类） */
  categoryId: string | null;
  /** 关联项目 ID（null=未绑定项目，独立待办） */
  projectId: string | null;
  /** 负责人（为空字符串表示未分配，用于多人场景数据隔离） */
  responsiblePerson: string;
  /** 完成时间（status=done 时记录，否则空字符串） */
  completedAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateTodoInput {
  content: string;
  link?: string;
  dueDate?: string;
  priority?: TodoPriority;
  status?: TodoStatus;
  pinned?: boolean;
  categoryId?: string | null;
  projectId?: string | null;
  responsiblePerson?: string;
}

/** 待办分类 */
export interface Category {
  id: string;
  name: string;
  /** 排序序号（UI 页签顺序） */
  sortOrder: number;
  /** 分类颜色（页签/徽章配色，十六进制如 #ef4444） */
  color: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateCategoryInput {
  name: string;
  sortOrder?: number;
  color?: string;
}

export interface SavedFilter {
  id: string;
  name: string;
  appId: string | null;
  versionId: string | null;
  progress: ProjectProgress | null;
  responsiblePerson: string | null;
  keyword: string;
}

export interface DefaultTodoTemplate {
  content: string;
  link: string;
  dueDate: string;
}

/**
 * 数据目录内的配置（跟着数据存储路径走）。
 * 这些配置是数据集本身的属性，切换数据路径或共享数据时一起生效。
 * 存储位置：{dataPath}/.workflow-hub-config.json
 */
export interface DataConfig {
  /** 新建项目时默认选中的 APP ID */
  defaultAppId: string | null;
  /** 自定义流程阶段 */
  progressStages: ProgressStage[];
  /** 哪个阶段为预发布轮次 */
  preReleaseRound: string;
  /** 默认待办模板 */
  defaultTodos: DefaultTodoTemplate[];
  /** 负责人列表 */
  responsiblePersons: string[];
  /** 新建待办默认分类 ID（null=未分类） */
  defaultCategoryId: string | null;
  /** 项目列表中显示的列 */
  tableColumns: string[];
}

export const DEFAULT_DATA_CONFIG: DataConfig = {
  defaultAppId: null,
  progressStages: DEFAULT_PROGRESS_STAGES,
  preReleaseRound: 'B3集成测试',
  defaultTodos: [],
  responsiblePersons: [],
  defaultCategoryId: null,
  tableColumns: ['name', 'appVersion', 'manager', 'responsiblePerson', 'features', 'spec', 'progress', 'currentRound', 'nextStage', 'nextStageTime', 'links', 'todos'],
};

export interface PluginSettings {
  autoBackup: boolean;
  backupDay: number;
  backupHour: number;
  lastBackupTime: string | null;
  dataPath: string;
  backupPath: string;
  overdueWarningDays: number;
  autoRefreshInterval: number;
  /** 数据迁移是否已完成（避免重复迁移） */
  migrationCompleted: boolean;
  /** 智能继承最后执行日期（YYYY-DD-MM，避免重复执行） */
  inheritanceLastRun: string | null;
  /** 迁移错误信息（失败时记录，供手动重试） */
  migrationError: string | null;
  /** 旧 AVM 数据路径（支持 vault 相对路径或绝对路径） */
  oldDataPath: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  autoBackup: true,
  backupDay: 5,
  backupHour: 23,
  lastBackupTime: null,
  dataPath: 'workflow-hub',
  backupPath: '',
  overdueWarningDays: 3,
  autoRefreshInterval: 2,
  migrationCompleted: false,
  inheritanceLastRun: null,
  migrationError: null,
  oldDataPath: 'app-version-manager',
};

export function getProgressOrder(stages: ProgressStage[]): ProjectProgress[] {
  return stages.map((s) => s.name);
}

export function getProgressColors(stages: ProgressStage[]): Record<string, string> {
  const colors: Record<string, string> = {};
  stages.forEach((s) => {
    colors[s.name] = s.color;
  });
  return colors;
}

export function getFirstProgress(stages: ProgressStage[]): ProjectProgress {
  return stages.length > 0 ? stages[0].name : '';
}

export function getLastProgress(stages: ProgressStage[]): ProjectProgress {
  return stages.length > 0 ? stages[stages.length - 1].name : '';
}

export const TEST_STAGES = [
  { key: 'b1IntegrationTestTime', label: 'B1集成测试' },
  { key: 'b1SystemTestTime', label: 'B1系统测试' },
  { key: 'b2IntegrationTestTime', label: 'B2集成测试' },
  { key: 'b2SystemTestTime', label: 'B2系统测试' },
  { key: 'b3IntegrationTestTime', label: 'B3集成测试' },
  { key: 'b3SystemTestTime', label: 'B3系统测试' },
  { key: 'b4IntegrationTestTime', label: 'B4集成测试' },
  { key: 'b4SystemTestTime', label: 'B4系统测试' },
] as const;

// B 轮阶段配色，供各视图的轮次徽章统一使用（避免重复定义）
export const ROUND_COLORS: Record<string, string> = {
  'B1集成测试': '#3b82f6',
  'B1系统测试': '#3b82f6',
  'B2集成测试': '#8b5cf6',
  'B2系统测试': '#8b5cf6',
  'B3集成测试': '#f59e0b',
  'B3系统测试': '#f59e0b',
  'B4集成测试': '#ef4444',
  'B4系统测试': '#ef4444',
  '未安排': '#64748b',
};

// 日期解析函数，支持多种格式
export function parseDateInput(input: string): string | null {
  if (!input || input.trim() === '') return null;

  const trimmed = input.trim();

  // 先检测明确的 MM.DD 格式（必须在 new Date() 之前处理，避免 V8 将 "2.10" 解析为 2026-02-10 导致时区偏移问题）
  const mmddMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (mmddMatch) {
    const month = parseInt(mmddMatch[1]);
    const day = parseInt(mmddMatch[2]);
    const year = new Date().getFullYear();
    const testDate = new Date(year, month - 1, day);
    if (testDate.getFullYear() === year && testDate.getMonth() === month - 1 && testDate.getDate() === day) {
      return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    }
  }

  // 对于 ISO 格式（YYYY-MM-DD），直接解析组件避免 UTC 时区偏移
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1]);
    const month = parseInt(isoMatch[2]);
    const day = parseInt(isoMatch[3]);
    const testDate = new Date(year, month - 1, day);
    if (
      testDate.getFullYear() === year &&
      testDate.getMonth() === month - 1 &&
      testDate.getDate() === day
    ) {
      return formatLocalDate(testDate);
    }
  }

  // 尝试直接解析为Date对象
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    // 如果解析出来的年份是2001，说明输入可能只是月日格式（如"03-25"），
    // JavaScript默认给了2001年，此时应该用当前年份代替
    const parsedYear = date.getFullYear();
    if (parsedYear === 2001 && !/\d{4}/.test(trimmed)) {
      const currentYear = new Date().getFullYear();
      const month = date.getMonth();
      const day = date.getDate();
      const correctedDate = new Date(currentYear, month, day);
      return formatLocalDate(correctedDate);
    }
    return formatLocalDate(date);
  }

  // 支持常见格式的正则表达式
  const patterns = [
    // YYYY-MM-DD or YYYY/MM/DD
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/,
    // MM/DD/YYYY or DD/MM/YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    // YYYY年MM月DD日
    /^(\d{4})年(\d{1,2})月(\d{1,2})日?$/,
    // MM月DD日YYYY年
    /^(\d{1,2})月(\d{1,2})日(\d{4})年$/,
    // DD日MM月YYYY年
    /^(\d{1,2})日(\d{1,2})月(\d{4})年$/,
    // MM-DD (month-day with current year)
    /^(\d{1,2})-(\d{1,2})$/,
    // MM.DD (month.day with current year)
    /^(\d{1,2})\.(\d{1,2})$/,
    // MM月DD日 (month day with current year)
    /^(\d{1,2})月(\d{1,2})日?$/,
    // DD日MM月 (day month with current year)
    /^(\d{1,2})日(\d{1,2})月$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      let year: number, month: number, day: number;

      if (pattern === patterns[0]) {
        // YYYY-MM-DD/YYYY/MM/DD
        year = parseInt(match[1]);
        month = parseInt(match[2]);
        day = parseInt(match[3]);
      } else if (pattern === patterns[1]) {
        // MM/DD/YYYY or DD/MM/YYYY
        month = parseInt(match[1]);
        day = parseInt(match[2]);
        year = parseInt(match[3]);
      } else if (pattern === patterns[2]) {
        // YYYY年MM月DD日
        year = parseInt(match[1]);
        month = parseInt(match[2]);
        day = parseInt(match[3]);
      } else if (pattern === patterns[3]) {
        // MM月DD日YYYY年
        month = parseInt(match[1]);
        day = parseInt(match[2]);
        year = parseInt(match[3]);
      } else if (pattern === patterns[4]) {
        // DD日MM月YYYY年
        day = parseInt(match[1]);
        month = parseInt(match[2]);
        year = parseInt(match[3]);
      } else if (pattern === patterns[5]) {
        // MM-DD (month-day with current year)
        month = parseInt(match[1]);
        day = parseInt(match[2]);
        year = new Date().getFullYear();
      } else if (pattern === patterns[6]) {
        // MM.DD (month.day with current year)
        month = parseInt(match[1]);
        day = parseInt(match[2]);
        year = new Date().getFullYear();
      } else if (pattern === patterns[7]) {
        // MM月DD日 (month day with current year)
        month = parseInt(match[1]);
        day = parseInt(match[2]);
        year = new Date().getFullYear();
      } else {
        // DD日MM月 (day month with current year)
        day = parseInt(match[1]);
        month = parseInt(match[2]);
        year = new Date().getFullYear();
      }

      // 验证日期有效性
      const testDate = new Date(year, month - 1, day);
      if (testDate.getFullYear() === year && testDate.getMonth() === month - 1 && testDate.getDate() === day) {
        return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      }
    }
  }

  return null; // 无法解析
}

/**
 * 预发布轮选项对应的触发点（上一轮的系统测试阶段 key）。
 * 例如：B3集成测试 的触发点是 B2系统测试，即 B2 系统测试时间已过则进入预发布。
 */
const PRE_RELEASE_TRIGGERS: Record<string, string> = {
  'B2系统测试': 'b1SystemTestTime',
  'B3集成测试': 'b2SystemTestTime',
  'B3系统测试': 'b2SystemTestTime',
  'B4集成测试': 'b3SystemTestTime',
  'B4系统测试': 'b3SystemTestTime',
};

/**
 * 判断项目是否已进入预发布状态。
 * 规则：从触发点（上一轮系统测试）开始的任一时间已过（或今天），即视为已进入预发布阶段。
 * 即使中间某些阶段时间未填，只要触发点或之后的某个阶段时间已过，就高亮。
 */
export function isProjectInPreRelease(project: Project, preReleaseRound: string, lastProgress: string): boolean {
  // 已发布的项目不显示预发布提示
  if (project.progress === lastProgress) return false;

  // 找到触发点阶段
  const triggerKey = PRE_RELEASE_TRIGGERS[preReleaseRound];
  if (!triggerKey) return false;

  const triggerIndex = TEST_STAGES.findIndex((s) => s.key === triggerKey);
  if (triggerIndex < 0) return false;

  const now = todayStart();

  // 检查触发点及之后的任一时间是否已过（或今天）
  for (let i = triggerIndex; i < TEST_STAGES.length; i++) {
    const timeStr = (project as any)[TEST_STAGES[i].key];
    if (timeStr && timeStr.trim() !== '') {
      const stageDate = parseLocalDate(timeStr);
      if (stageDate <= now) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 获取项目当前所在的 B 轮阶段（完整标签）。
 *
 * 规则：以最近一个已过的日期作为当前阶段。
 *   - 若 B1 系统测试已过，B2 集成测试未填或未到 → 显示 "B1系统测试"
 *   - 若所有日期都已过 → 显示最晚一个有日期的阶段
 *   - 若所有日期都未到 → 显示最早一个有日期的阶段
 *   - 若无任何日期 → 显示 '未安排'
 */
export function getCurrentBRound(project: Project): string {
  const now = todayStart();

  // 找最近一个已过的阶段（从后往前找）
  for (let i = TEST_STAGES.length - 1; i >= 0; i--) {
    const timeStr = (project as any)[TEST_STAGES[i].key];
    if (timeStr) {
      const stageDate = parseLocalDate(timeStr);
      if (stageDate <= now) {
        return TEST_STAGES[i].label;
      }
    }
  }

  // 所有日期都未到 → 返回最早一个有日期的阶段
  for (const stage of TEST_STAGES) {
    if ((project as any)[stage.key]) {
      return stage.label;
    }
  }

  return '未安排';
}

// 获取项目的下一阶段信息
export function getNextStageInfo(project: Project): { stage: string; time: string } {
  const now = todayStart();

  let nextStage: string | null = null;
  let nextTime: string | null = null;
  let nextDate: Date | null = null;

  for (const stage of TEST_STAGES) {
    const timeStr = (project as any)[stage.key];
    if (timeStr) {
      const stageDate = parseLocalDate(timeStr);

      if (stageDate >= now) {
        if (!nextDate || stageDate < nextDate) {
          nextStage = stage.label;
          nextTime = timeStr;
          nextDate = stageDate;
        }
      }
    }
  }

  return {
    stage: nextStage || '无',
    time: nextTime || '',
  };
}
