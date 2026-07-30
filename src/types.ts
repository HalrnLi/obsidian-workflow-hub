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

export interface PluginSettings {
  defaultAppId: string | null;
  autoBackup: boolean;
  backupDay: number;
  backupHour: number;
  lastBackupTime: string | null;
  dataPath: string;
  backupPath: string;
  progressStages: ProgressStage[];
  overdueWarningDays: number;
  autoRefreshInterval: number;
  defaultTodos: DefaultTodoTemplate[];
  responsiblePersons: string[];
  preReleaseRound: string; // 哪个B轮为预发布轮次，B1/B2/B3/B4，默认B3
  /** 新建待办默认分类 ID（null=未分类） */
  defaultCategoryId: string | null;
  /** 数据迁移是否已完成（避免重复迁移） */
  migrationCompleted: boolean;
  /** 智能继承最后执行日期（YYYY-DD-MM，避免重复执行） */
  inheritanceLastRun: string | null;
  /** 迁移错误信息（失败时记录，供手动重试） */
  migrationError: string | null;
  /** 旧 AVM 数据路径（支持 vault 相对路径或绝对路径） */
  oldDataPath: string;
  /** 项目列表中显示的列 */
  tableColumns: string[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultAppId: null,
  autoBackup: true,
  backupDay: 5,
  backupHour: 23,
  lastBackupTime: null,
  dataPath: 'workflow-hub',
  backupPath: '',
  progressStages: DEFAULT_PROGRESS_STAGES,
  overdueWarningDays: 3,
  autoRefreshInterval: 2,
  defaultTodos: [],
  responsiblePersons: [],
  preReleaseRound: 'B3',
  defaultCategoryId: null,
  migrationCompleted: false,
  inheritanceLastRun: null,
  migrationError: null,
  oldDataPath: 'app-version-manager',
  tableColumns: ['name', 'appVersion', 'manager', 'responsiblePerson', 'features', 'spec', 'progress', 'currentRound', 'nextStage', 'nextStageTime', 'links', 'todos'],
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
  B1: '#3b82f6',
  B2: '#8b5cf6',
  B3: '#f59e0b',
  B4: '#ef4444',
  未安排: '#64748b',
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

// B2 系统测试及之后的所有阶段字段（用于判断项目是否已进入预发布高亮）
const B2_AND_LATER_FIELDS: string[] = [
  'b2SystemTestTime',
  'b2IntegrationTestTime',
  'b3SystemTestTime',
  'b3IntegrationTestTime',
  'b4SystemTestTime',
  'b4IntegrationTestTime',
];

/**
 * 判断项目是否已进入预发布状态。
 * 规则：项目已进入 B2 系统测试或更后的阶段（任一轮次字段有值即视为已进入），
 * 且项目未到最后一个进度阶段（已发布）。不比较日期，无论提测时间是否已过。
 */
export function isProjectInPreRelease(project: Project, _preReleaseRound: string, lastProgress: string): boolean {
  // 已发布的项目不显示预发布提示
  if (project.progress === lastProgress) return false;

  // 只要 B2 系统测试或更后的任一轮次字段有值，即视为已进入预发布阶段
  return B2_AND_LATER_FIELDS.some((field) => {
    const val = (project as any)[field];
    return val && val.trim() !== '';
  });
}

/**
 * 获取项目当前所在的 B 轮阶段。
 * 基于最近的未来日期判断；若所有日期已过，取最晚的 B 轮；若无日期则返回 '未安排'。
 */
export function getCurrentBRound(project: Project): string {
  const nextInfo = getNextStageInfo(project);
  if (nextInfo.stage !== '无') {
    const match = nextInfo.stage.match(/B(\d)/);
    return match ? `B${match[1]}` : '未安排';
  }
  // 所有日期已过 — 找最晚有日期的 B 轮
  for (let i = TEST_STAGES.length - 1; i >= 0; i--) {
    if ((project as any)[TEST_STAGES[i].key]) {
      const match = TEST_STAGES[i].key.match(/b(\d)/);
      return match ? `B${match[1]}` : '未安排';
    }
  }
  return '未安排';
}

// 获取项目的下一阶段信息
export function getNextStageInfo(project: Project): { stage: string; time: string } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  let nextStage: string | null = null;
  let nextTime: string | null = null;
  let nextDate: Date | null = null;

  for (const stage of TEST_STAGES) {
    const timeStr = (project as any)[stage.key];
    if (timeStr) {
      const stageDate = new Date(timeStr);
      stageDate.setHours(0, 0, 0, 0);

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
