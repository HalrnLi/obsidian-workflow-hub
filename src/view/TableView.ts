import { Menu, Modal, App as ObsidianApp, Setting, Notice } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import {
  Project,
  Version,
  ProjectProgress,
  getProgressOrder,
  getProgressColors,
  App,
  TEST_STAGES,
  getLastProgress,
  getNextStageInfo,
  isProjectInPreRelease,
  getCurrentBRound,
  ROUND_COLORS,
} from '../types';
import { ConfirmModal } from './ConfirmModal';
import { createActionButtons } from './ModalUtils';
import { EditProjectModal } from './EditProjectModal';
import { TestPlanModal } from './modals/TestPlanModal';
import { ProjectInfoModal } from './modals/ProjectInfoModal';
import { ProjectTodosModal } from './modals/ProjectTodosModal';
import { sortProjectsByPriority, isProjectHighlighted, checkOverdue } from '../utils/projectSorting';
import { openExternalLink } from '../utils/linkUtils';

interface TableColumn {
  key: string;
  label: string;
  width: string;
  sortable?: boolean;
}

interface SortState {
  column: string | null;
  direction: 'asc' | 'desc';
}

interface TableViewCallbacks {
  onRefresh: () => void;
  getTodoStats: (projectId: string) => Promise<{ total: number; completed: number; overdue: number }>;
  onOpenDetail: (projectId: string, projectName: string) => void;
  onCloseDetail: () => void;
}

export class TableView {
  containerEl: HTMLElement;
  plugin: AppVersionManagerPlugin;
  projects: Project[];
  versions: Version[];
  apps: App[];
  private callbacks: TableViewCallbacks;
  selectedProjectId: string | null;
  private sortState: SortState = { column: null, direction: 'asc' };
  
  // Backward-compatible aliases
  get onRefresh() { return this.callbacks.onRefresh; }
  get getTodoStats() { return this.callbacks.getTodoStats; }

  constructor(
    containerEl: HTMLElement,
    plugin: AppVersionManagerPlugin,
    projects: Project[],
    versions: Version[],
    apps: App[],
    callbacks: TableViewCallbacks,
    selectedProjectId: string | null = null,
  ) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.projects = projects;
    this.versions = versions;
    this.apps = apps;
    this.callbacks = callbacks;
    this.selectedProjectId = selectedProjectId;

    this.render();
  }

  private applySorting(projects: Project[]): Project[] {
    if (!this.sortState.column) {
      return sortProjectsByPriority(projects, this.plugin.settings.progressStages);
    }

    const { column, direction } = this.sortState;
    const progressOrder = getProgressOrder(this.plugin.settings.progressStages);
    const sign = direction === 'desc' ? -1 : 1;

    const sorted = [...projects].sort((a, b) => {
      let cmp = 0;

      switch (column) {
        case 'appVersion': {
          // 按第一个关联的 APP 名称 + 版本号排序
          const getAppVersionLabel = (p: Project): string => {
            if (p.appVersionLinks.length === 0) return '';
            const link = p.appVersionLinks[0];
            const app = this.apps.find((a) => a.id === link.appId);
            const version = this.versions.find((v) => v.id === link.versionId);
            return `${app?.name || ''}/${version?.versionNumber || ''}`;
          };
          const aStr = getAppVersionLabel(a);
          const bStr = getAppVersionLabel(b);
          if (aStr === '' && bStr === '') break;
          if (aStr === '') return 1;
          if (bStr === '') return -1;
          cmp = aStr.localeCompare(bStr);
          break;
        }
        case 'manager': {
          const aStr = a.manager || '';
          const bStr = b.manager || '';
          if (aStr === '' && bStr === '') break;
          if (aStr === '') return 1;
          if (bStr === '') return -1;
          cmp = aStr.localeCompare(bStr);
          break;
        }
        case 'features': {
          const aStr = a.features || '';
          const bStr = b.features || '';
          if (aStr === '' && bStr === '') break;
          if (aStr === '') return 1;
          if (bStr === '') return -1;
          cmp = aStr.localeCompare(bStr);
          break;
        }
        case 'progress': {
          const aIdx = progressOrder.indexOf(a.progress);
          const bIdx = progressOrder.indexOf(b.progress);
          cmp = aIdx - bIdx;
          break;
        }
        case 'nextStageTime': {
          const infoA = getNextStageInfo(a);
          const infoB = getNextStageInfo(b);
          const timeA = infoA.time ? new Date(infoA.time).getTime() : null;
          const timeB = infoB.time ? new Date(infoB.time).getTime() : null;
          if (timeA === null && timeB === null) break;
          if (timeA === null) return 1;
          if (timeB === null) return -1;
          cmp = timeA - timeB;
          break;
        }
        default:
          return 0;
      }

      return cmp * sign;
    });

    return sorted;
  }

  private toggleSort(column: string) {
    if (this.sortState.column === column) {
      this.sortState = {
        column,
        direction: this.sortState.direction === 'asc' ? 'desc' : 'asc',
      };
    } else {
      this.sortState = { column, direction: 'asc' };
    }
    this.render();
  }

  private render() {
    this.containerEl.empty();
    this.containerEl.addClass('avm-table-view');

    const tableWrapper = this.containerEl.createDiv({ cls: 'avm-table-wrapper' });
    const table = tableWrapper.createEl('table', { cls: 'avm-table' });

    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');

    // 所有可用列定义
    const allColumns: TableColumn[] = [
      { key: 'name', label: '项目名称', width: '150px' },
      { key: 'appVersion', label: 'APP / 版本', width: '150px', sortable: true },
      { key: 'manager', label: '项目经理', width: '100px', sortable: true },
      { key: 'responsiblePerson', label: '负责人', width: '100px', sortable: true },
      { key: 'features', label: '特性', width: '150px', sortable: true },
      { key: 'spec', label: '配置组件/规格', width: '150px' },
      { key: 'progress', label: '进度', width: '120px', sortable: true },
      { key: 'currentRound', label: '当前阶段', width: '80px' },
      { key: 'nextStage', label: '下一阶段', width: '120px' },
      { key: 'nextStageTime', label: '下一阶段时间', width: '120px', sortable: true },
      { key: 'links', label: '链接', width: '120px' },
      { key: 'todos', label: '待办', width: '100px' },
    ];

    // 根据设置过滤显示的列
    const enabledColumns = this.plugin.settings.tableColumns || [];
    const columns = allColumns.filter((col) => enabledColumns.includes(col.key));

    columns.forEach((col) => {
      const th = headerRow.createEl('th');
      th.style.width = col.width;

      const labelSpan = th.createSpan({ text: col.label });

      if (col.sortable) {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => this.toggleSort(col.key));

        const iconSpan = th.createSpan({ cls: 'avm-sort-icon' });
        if (this.sortState.column === col.key) {
          iconSpan.textContent = this.sortState.direction === 'asc' ? ' ↑' : ' ↓';
        } else {
          iconSpan.textContent = '';
        }
      }
    });

    const tbody = table.createEl('tbody');

    const sortedProjects = this.applySorting(this.projects);

    if (sortedProjects.length === 0) {
      const emptyRow = tbody.createEl('tr');
      const emptyCell = emptyRow.createEl('td', { attr: { colspan: columns.length.toString() } });
      emptyCell.createDiv({ cls: 'avm-empty-state', text: '暂无数据' });
    } else {
      sortedProjects.forEach((project) => {
        this.renderRow(tbody, project, columns);
      });
    }
  }

  private isProjectHighlighted(project: Project): boolean {
    return isProjectHighlighted(project, this.plugin.settings.overdueWarningDays);
  }

  private renderRow(tbody: HTMLElement, project: Project, columns: TableColumn[]) {
    const row = tbody.createEl('tr');

    if (this.isProjectHighlighted(project)) {
      row.addClass('avm-highlighted-row');
    }

    // 选中行高亮（当前打开详情的项目）
    if (this.selectedProjectId === project.id) {
      row.addClass('avm-selected-row');
    }

    const isOverdue = this.checkOverdue(project);
    if (isOverdue) {
      row.addClass('avm-overdue-row');
    }

    const lastProgress = getLastProgress(this.plugin.settings.progressStages);
    const isPreRelease = isProjectInPreRelease(project, this.plugin.settings.preReleaseRound, lastProgress);
    if (isPreRelease) {
      row.addClass('avm-pre-release-row');
    }

    const nextStageInfo = getNextStageInfo(project);

    columns.forEach((col) => {
      const td = row.createEl('td');

      switch (col.key) {
        case 'name':
          td.createDiv({ cls: 'avm-cell-name', text: project.name });
          break;

        case 'appVersion': {
          const container = td.createDiv({ cls: 'avm-cell-app-version' });
          if (project.appVersionLinks.length === 0) {
            container.createSpan({ text: '-' });
          } else {
            project.appVersionLinks.forEach((link) => {
              const app = this.apps.find((a) => a.id === link.appId);
              const version = this.versions.find((v) => v.id === link.versionId);
              const appLabel = app?.name || '(未知)';
              const verLabel = version?.versionNumber || '(未知)';
              container.createDiv({ cls: 'avm-cell-app-version-item', text: `${appLabel} / ${verLabel}` });
            });
          }
          break;
        }

        case 'manager':
          td.createDiv({ text: project.manager || '-' });
          break;

        case 'responsiblePerson':
          td.createDiv({ text: project.responsiblePerson || '-' });
          break;

        case 'features':
          td.createDiv({ cls: 'avm-cell-features', text: project.features || '-' });
          break;

        case 'spec':
          td.createDiv({ cls: 'avm-cell-spec', text: project.spec || '-' });
          break;

        case 'progress': {
          const progressColors = getProgressColors(this.plugin.settings.progressStages);
          const badge = td.createDiv({ cls: 'avm-progress-badge-small avm-clickable', text: project.progress });
          badge.style.backgroundColor = progressColors[project.progress] || '#64748b';
          badge.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleProgressClick(project);
          });
          break;
        }
        case 'currentRound': {
          const round = getCurrentBRound(project);
          const roundBadge = td.createSpan({ cls: 'avm-round-badge', text: round });
          roundBadge.style.backgroundColor = ROUND_COLORS[round] || '#64748b';
          if (isPreRelease) {
            roundBadge.addClass('avm-round-badge-prerelease');
          }
          break;
        }
        case 'todos': {
          const todoBadge = td.createDiv({ cls: 'avm-todo-badge', text: '📋' });
          this.getTodoStats(project.id)
            .then((stats) => {
              if (stats.total > 0) {
                todoBadge.setText(`${stats.completed}/${stats.total}`);
                if (stats.overdue > 0) todoBadge.addClass('has-overdue');
              }
            })
            .catch(console.error);
          break;
        }
        case 'nextStage':
          td.createDiv({ text: nextStageInfo.stage });
          break;

        case 'nextStageTime':
          td.createDiv({ text: nextStageInfo.time });
          break;

        case 'links': {
          const linksContainer = td.createDiv({ cls: 'avm-cell-links' });

          if (project.projectLink) {
            const link = linksContainer.createEl('a', {
              cls: 'avm-link-small',
              text: '项目',
              attr: { href: '#' },
            });
            link.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              openExternalLink(project.projectLink);
            });
          }

          if (project.componentLink) {
            const link = linksContainer.createEl('a', {
              cls: 'avm-link-small',
              text: '组件',
              attr: { href: '#' },
            });
            link.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              openExternalLink(project.componentLink);
            });
          }

          if (!project.projectLink && !project.componentLink) {
            td.createDiv({ text: '-' });
          }
          break;
        }
      }
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showRowContextMenu(project, e);
    });

    row.addEventListener('dblclick', (e) => {
      e.preventDefault();
      // 如果双击的是已选中的项目，则关闭详情；否则打开详情
      if (this.selectedProjectId === project.id) {
        this.callbacks.onCloseDetail();
      } else {
        this.callbacks.onOpenDetail(project.id, project.name);
      }
    });
  }

  private checkOverdue(project: Project): boolean {
    return checkOverdue(project, this.plugin.settings.progressStages, this.plugin.settings.overdueWarningDays);
  }

  private showRowContextMenu(project: Project, event: MouseEvent) {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle('编辑')
        .setIcon('pencil')
        .onClick(() => this.showEditProjectModal(project)),
    );

    menu.addItem((item) =>
      item
        .setTitle('提测计划')
        .setIcon('calendar')
        .onClick(() => this.showTestPlanModal(project)),
    );

    menu.addItem((item) =>
      item
        .setTitle('项目信息')
        .setIcon('file-text')
        .onClick(() => this.showProjectInfoModal(project)),
    );

    menu.addItem((item) =>
      item
        .setTitle('项目待办')
        .setIcon('checkmark')
        .onClick(() => this.showProjectTodosModal(project)),
    );

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle('删除')
        .setIcon('trash')
        .onClick(() => {
          new ConfirmModal(
            this.plugin.app,
            '删除项目',
            `确定要删除项目 "${project.name}" 吗？`,
            async () => {
              try {
                await this.plugin.dataService.deleteProject(project.id);
                setTimeout(() => this.onRefresh(), 100);
              } catch (error) {
                new Notice(error instanceof Error ? error.message : String(error));
              }
            },
            undefined,
            true,
          ).open();
        }),
    );

    menu.showAtMouseEvent(event);
  }

  private handleProgressClick(project: Project) {
    const progressOrder = getProgressOrder(this.plugin.settings.progressStages);
    const currentIndex = progressOrder.indexOf(project.progress);
    if (currentIndex === -1 || currentIndex >= progressOrder.length - 1) {
      return;
    }

    const nextProgress = progressOrder[currentIndex + 1];
    new ProgressConfirmModal(this.plugin.app, project, nextProgress, this.plugin.settings.progressStages, async () => {
      try {
        await this.plugin.dataService.updateProject(project.id, { progress: nextProgress }, project.version);
        this.onRefresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private showEditProjectModal(project: Project) {
    new EditProjectModal(
      this.plugin.app,
      project,
      this.apps,
      this.versions,
      this.plugin.settings.progressStages,
      this.plugin.settings.responsiblePersons,
      async (data) => {
        try {
          await this.plugin.dataService.updateProject(project.id, data, project.version);
          this.onRefresh();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      },
    ).open();
  }

  private showTestPlanModal(project: Project) {
    new TestPlanModal(this.plugin.app, project, async (testData) => {
      try {
        await this.plugin.dataService.updateProject(project.id, testData, project.version);
        this.onRefresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private showProjectInfoModal(project: Project) {
    new ProjectInfoModal(this.plugin.app, this.plugin, project, () => this.onRefresh()).open();
  }

  private showProjectTodosModal(project: Project) {
    new ProjectTodosModal(this.plugin.app, this.plugin, project, () => this.onRefresh()).open();
  }
}

class ProgressConfirmModal extends Modal {
  project: Project;
  nextProgress: ProjectProgress;
  progressStages: { name: string; color: string }[];
  onConfirm: () => void;

  constructor(
    app: ObsidianApp,
    project: Project,
    nextProgress: ProjectProgress,
    progressStages: { name: string; color: string }[],
    onConfirm: () => void,
  ) {
    super(app);
    this.project = project;
    this.nextProgress = nextProgress;
    this.progressStages = progressStages;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');
    contentEl.addClass('avm-progress-confirm-modal');

    contentEl.createEl('h2', { text: '确认更改进度' });

    const progressColors = getProgressColors(this.progressStages);

    const infoContainer = contentEl.createDiv({ cls: 'avm-confirm-info' });

    const projectInfo = infoContainer.createDiv({ cls: 'avm-confirm-project' });
    projectInfo.createEl('span', { cls: 'avm-confirm-label', text: '项目：' });
    projectInfo.createEl('span', { text: this.project.name });

    const progressContainer = infoContainer.createDiv({ cls: 'avm-confirm-progress' });

    const currentDiv = progressContainer.createDiv({ cls: 'avm-progress-item' });
    currentDiv.createEl('div', { cls: 'avm-confirm-label', text: '当前进度' });
    const currentBadge = currentDiv.createDiv({ cls: 'avm-progress-badge-small', text: this.project.progress });
    currentBadge.style.backgroundColor = progressColors[this.project.progress] || '#64748b';

    const arrow = progressContainer.createDiv({ cls: 'avm-progress-arrow' });
    arrow.createEl('span', { text: '→' });

    const nextDiv = progressContainer.createDiv({ cls: 'avm-progress-item' });
    nextDiv.createEl('div', { cls: 'avm-confirm-label', text: '下一进度' });
    const nextBadge = nextDiv.createDiv({ cls: 'avm-progress-badge-small', text: this.nextProgress });
    nextBadge.style.backgroundColor = progressColors[this.nextProgress] || '#64748b';

    createActionButtons(contentEl, {
      confirmText: '确认更改',
      cancelText: '取消',
      onConfirm: () => {
        this.onConfirm();
        this.close();
      },
      onCancel: () => this.close(),
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
