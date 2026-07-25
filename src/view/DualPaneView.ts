import { Menu, Modal, App as ObsidianApp, Setting, ButtonComponent, Notice } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import {
  Version,
  Project,
  ProjectProgress,
  getProgressOrder,
  getProgressColors,
  App,
  parseDateInput,
  getNextStageInfo,
  getLastProgress,
  isProjectInPreRelease,
  getCurrentBRound,
  ROUND_COLORS,
} from '../types';
import { ConfirmModal } from './ConfirmModal';
import { createSaveButtons } from './ModalUtils';
import { EditProjectModal } from './EditProjectModal';
import { TestPlanModal } from './modals/TestPlanModal';
import { ProjectInfoModal } from './modals/ProjectInfoModal';
import { ProjectTodosModal } from './modals/ProjectTodosModal';
import { sortProjectsByPriority, isProjectHighlighted, checkOverdue, calculateOverdueStats } from '../utils/projectSorting';
import { openExternalLink } from '../utils/linkUtils';

interface FilterState {
  appId: string | null;
  versionId: string | null;
}

export class DualPaneView {
  containerEl: HTMLElement;
  plugin: AppVersionManagerPlugin;
  apps: App[];
  versions: Version[];
  projects: Project[];
  currentFilter: FilterState;
  onFilterChange: (filter: Partial<FilterState>) => void;
  onCreateProject: () => void;
  onRefresh: () => void;
  getTodoStats: (projectId: string) => Promise<{ total: number; completed: number; overdue: number }>;
  onOpenTodos: (projectId: string, projectName: string) => void;

  // 左侧 APP 展开状态
  private expandedApps: Set<string> = new Set();

  constructor(
    containerEl: HTMLElement,
    plugin: AppVersionManagerPlugin,
    apps: App[],
    versions: Version[],
    projects: Project[],
    currentFilter: FilterState,
    onCreateProject: () => void,
    onRefresh: () => void,
    getTodoStats: (projectId: string) => Promise<{ total: number; completed: number; overdue: number }>,
    onOpenTodos: (projectId: string, projectName: string) => void,
  ) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.apps = apps;
    this.versions = versions;
    this.projects = projects;
    this.currentFilter = currentFilter;
    this.onCreateProject = onCreateProject;
    this.onRefresh = onRefresh;
    this.getTodoStats = getTodoStats;
    this.onOpenTodos = onOpenTodos;

    // 默认展开当前选中的 APP
    if (currentFilter.appId) {
      this.expandedApps.add(currentFilter.appId);
    }

    this.render();
  }

  private render() {
    this.containerEl.empty();
    this.containerEl.addClass('avm-dual-pane');

    const leftPane = this.containerEl.createDiv({ cls: 'avm-left-pane' });
    this.renderAppVersionBrowser(leftPane);

    const rightPane = this.containerEl.createDiv({ cls: 'avm-right-pane' });
    this.renderProjectList(rightPane);
  }

  /** 左侧：APP/版本浏览器 */
  private renderAppVersionBrowser(container: HTMLElement) {
    container.empty();

    const header = container.createDiv({ cls: 'avm-pane-header' });
    header.createEl('h3', { text: 'APP / 版本' });

    // "全部"选项
    const allItem = container.createDiv({
      cls: `avm-app-browser-item avm-app-browser-all ${!this.currentFilter.appId ? 'avm-selected' : ''}`,
    });
    allItem.createSpan({ cls: 'avm-app-browser-name', text: '全部项目' });
    const allCount = this.projects.length;
    allItem.createSpan({ cls: 'avm-app-browser-count', text: `${allCount}` });
    allItem.addEventListener('click', () => {
      this.currentFilter = { appId: null, versionId: null };
      this.onFilterChange(this.currentFilter);
      this.render();
    });

    const browserList = container.createDiv({ cls: 'avm-app-browser-list' });

    // 按 APP 分组
    this.apps.forEach((app) => {
      const appVersions = this.versions.filter((v) => v.appId === app.id && !v.isArchived);
      const appProjects = this.projects.filter((p) => p.appVersionLinks.some((link) => link.appId === app.id));

      const isExpanded = this.expandedApps.has(app.id);
      const isSelected = this.currentFilter.appId === app.id && !this.currentFilter.versionId;

      const appItem = browserList.createDiv({
        cls: `avm-app-browser-item ${isSelected ? 'avm-selected' : ''}`,
      });

      // 展开/折叠图标
      const expandIcon = appItem.createSpan({
        cls: 'avm-app-browser-expand',
        text: isExpanded ? '▼' : '▶',
      });

      appItem.createSpan({ cls: 'avm-app-browser-name', text: app.name });
      appItem.createSpan({ cls: 'avm-app-browser-count', text: `${appProjects.length}` });

      appItem.addEventListener('click', (e) => {
        // 点击展开图标区域时只展开/折叠，不筛选
        if (e.target === expandIcon) {
          if (isExpanded) {
            this.expandedApps.delete(app.id);
          } else {
            this.expandedApps.add(app.id);
          }
          this.render();
          return;
        }
        // 点击其他区域：选中 APP 并展开
        this.expandedApps.add(app.id);
        this.currentFilter = { appId: app.id, versionId: null };
        this.onFilterChange(this.currentFilter);
        this.render();
      });

      // 展开时显示版本列表
      if (isExpanded && appVersions.length > 0) {
        const versionList = browserList.createDiv({ cls: 'avm-version-sublist' });
        appVersions.forEach((version) => {
          const versionProjects = this.projects.filter((p) =>
            p.appVersionLinks.some((link) => link.versionId === version.id),
          );
          const isVersionSelected = this.currentFilter.versionId === version.id;

          const versionItem = versionList.createDiv({
            cls: `avm-version-subitem ${isVersionSelected ? 'avm-selected' : ''}`,
          });
          versionItem.createSpan({ cls: 'avm-version-subitem-number', text: version.versionNumber });
          versionItem.createSpan({ cls: 'avm-version-subitem-count', text: `${versionProjects.length}` });

          versionItem.addEventListener('click', () => {
            this.currentFilter = { appId: app.id, versionId: version.id };
            this.onFilterChange(this.currentFilter);
            this.render();
          });
        });
      }
    });

    if (this.apps.length === 0) {
      browserList.createDiv({ cls: 'avm-empty-state', text: '暂无 APP' });
    }
  }

  private renderProjectList(container: HTMLElement) {
    container.empty();

    const header = container.createDiv({ cls: 'avm-pane-header' });
    header.createEl('h3', { text: '项目列表' });

    new ButtonComponent(header)
      .setIcon('plus')
      .setTooltip('新建项目')
      .onClick(() => {
        this.onCreateProject();
      });

    const projectList = container.createDiv({ cls: 'avm-project-list' });

    if (this.projects.length === 0) {
      projectList.createDiv({ cls: 'avm-empty-state', text: '暂无项目，点击右上角添加' });
      return;
    }

    const sortedProjects = this.applySorting(this.projects);

    sortedProjects.forEach((project) => {
      this.renderProjectItem(projectList, project);
    });
  }

  private isProjectHighlighted(project: Project): boolean {
    return isProjectHighlighted(project, this.plugin.settings.overdueWarningDays);
  }

  private applySorting(projects: Project[]): Project[] {
    return sortProjectsByPriority(projects, this.plugin.settings.progressStages);
  }

  private renderProjectItem(container: HTMLElement, project: Project) {
    const item = container.createDiv({ cls: 'avm-project-item' });

    if (this.isProjectHighlighted(project)) {
      item.addClass('avm-highlighted-row');
    }

    // 预发布横幅
    const lastProgress = getLastProgress(this.plugin.settings.progressStages);
    if (isProjectInPreRelease(project, this.plugin.settings.preReleaseRound, lastProgress)) {
      const banner = item.createDiv({ cls: 'avm-pre-release-banner' });
      banner.createSpan({ cls: 'avm-pre-release-icon', text: '⚠' });
      banner.createSpan({
        cls: 'avm-pre-release-text',
        text: `已进入预发布阶段（${this.plugin.settings.preReleaseRound}），后续修改请谨慎`,
      });
      item.addClass('avm-pre-release-item');
    }

    const header = item.createDiv({ cls: 'avm-project-header' });
    header.createDiv({ cls: 'avm-project-name', text: project.name });

    const progressColors = getProgressColors(this.plugin.settings.progressStages);
    const progressBadge = header.createDiv({
      cls: 'avm-progress-badge',
      text: project.progress,
    });
    progressBadge.style.backgroundColor = progressColors[project.progress] || '#64748b';

    // Todo badge
    const todoBadge = header.createDiv({ cls: 'avm-todo-badge', text: '📋' });
    this.getTodoStats(project.id)
      .then((stats) => {
        if (stats.total > 0) {
          todoBadge.setText(`${stats.completed}/${stats.total}`);
          if (stats.overdue > 0) todoBadge.addClass('has-overdue');
        }
      })
      .catch(console.error);

    // APP/版本标签
    if (project.appVersionLinks.length > 0) {
      const linksEl = item.createDiv({ cls: 'avm-project-links-tags' });
      project.appVersionLinks.forEach((link) => {
        const app = this.apps.find((a) => a.id === link.appId);
        const version = this.versions.find((v) => v.id === link.versionId);
        const label = app ? `${app.name}/${version?.versionNumber || '?'}` : '(未知)';
        linksEl.createSpan({ cls: 'avm-link-tag', text: label });
      });
    }

    if (project.features) {
      const featuresEl = item.createDiv({ cls: 'avm-project-features' });
      featuresEl.createEl('strong', { text: '特性:' });
      featuresEl.createSpan({ text: project.features.substring(0, 100) + (project.features.length > 100 ? '...' : '') });
    }

    if (project.spec) {
      const specEl = item.createDiv({ cls: 'avm-project-spec' });
      specEl.createEl('strong', { text: '配置组件/规格:' });
      specEl.createSpan({ text: project.spec.substring(0, 100) + (project.spec.length > 100 ? '...' : '') });
    }

    const isOverdue = this.checkOverdue(project);
    if (isOverdue) {
      item.addClass('avm-overdue');
    }

    const meta = item.createDiv({ cls: 'avm-project-meta' });

    // 当前 B 轮阶段徽章
    const currentRound = getCurrentBRound(project);
    const stageBadge = meta.createSpan({ cls: 'avm-meta-item avm-current-stage-badge' });
    stageBadge.createSpan({ cls: 'avm-stage-label', text: '当前阶段:' });
    const stageValue = stageBadge.createSpan({ cls: 'avm-stage-value', text: currentRound });
    stageValue.style.color = ROUND_COLORS[currentRound] || '#64748b';
    stageValue.style.fontWeight = '600';

    if (project.manager) {
      meta.createSpan({ cls: 'avm-meta-item', text: `👤 ${project.manager}` });
    }

    const links = item.createDiv({ cls: 'avm-project-links' });

    if (project.projectLink) {
      const link = links.createEl('a', {
        cls: 'avm-link',
        text: '项目链接',
        attr: { href: '#' },
      });
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openExternalLink(project.projectLink);
      });
    }

    if (project.componentLink) {
      const link = links.createEl('a', {
        cls: 'avm-link',
        text: '组件库',
        attr: { href: '#' },
      });
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openExternalLink(project.componentLink);
      });
    }

    if (project.requirements) {
      const req = item.createDiv({ cls: 'avm-project-requirements' });
      req.createEl('strong', { text: '需求:' });
      req.createSpan({ text: project.requirements.substring(0, 100) + (project.requirements.length > 100 ? '...' : '') });
    }

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showProjectContextMenu(project, e);
    });

    item.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.onOpenTodos(project.id, project.name);
    });
  }

  private checkOverdue(project: Project): boolean {
    return checkOverdue(project, this.plugin.settings.progressStages, this.plugin.settings.overdueWarningDays);
  }

  private showProjectContextMenu(project: Project, event: MouseEvent) {
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

  private showEditProjectModal(project: Project) {
    new EditProjectModal(this.plugin.app, project, this.apps, this.versions, this.plugin.settings.progressStages, this.plugin.settings.responsiblePersons, async (data) => {
      try {
        await this.plugin.dataService.updateProject(project.id, data, project.version);
        this.onRefresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
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
