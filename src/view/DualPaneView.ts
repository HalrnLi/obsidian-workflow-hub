import { Menu, Modal, App as ObsidianApp, Setting, ButtonComponent, TFile, Notice } from 'obsidian';
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
  ProgressStage,
} from '../types';
import { ConfirmModal } from './ConfirmModal';
import { createSaveButtons, createActionButtons } from './ModalUtils';
import { EditProjectModal } from './EditProjectModal';
import { TestPlanModal } from './modals/TestPlanModal';
import { ProjectInfoModal } from './modals/ProjectInfoModal';
import { ProjectTodosModal } from './modals/ProjectTodosModal';
import { sortProjectsByPriority, isProjectHighlighted, checkOverdue, calculateOverdueStats } from '../utils/projectSorting';
import { openExternalLink } from '../utils/linkUtils';

export class DualPaneView {
  containerEl: HTMLElement;
  plugin: AppVersionManagerPlugin;
  apps: App[];
  versions: Version[];
  projects: Project[];
  selectedVersionId: string | null;
  onVersionSelect: (versionId: string | null) => void;
  onCreateVersion: () => void;
  onCreateProject: () => void;
  onRefresh: () => void;
  getTodoStats: (projectId: string) => Promise<{ total: number; completed: number; overdue: number }>;
  onOpenTodos: (projectId: string, projectName: string) => void;

  constructor(
    containerEl: HTMLElement,
    plugin: AppVersionManagerPlugin,
    apps: App[],
    versions: Version[],
    projects: Project[],
    selectedVersionId: string | null,
    onVersionSelect: (versionId: string | null) => void,
    onCreateVersion: () => void,
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
    this.selectedVersionId = selectedVersionId;
    this.onVersionSelect = onVersionSelect;
    this.onCreateVersion = onCreateVersion;
    this.onCreateProject = onCreateProject;
    this.onRefresh = onRefresh;
    this.getTodoStats = getTodoStats;
    this.onOpenTodos = onOpenTodos;

    this.render();
  }

  private render() {
    this.containerEl.empty();
    this.containerEl.addClass('avm-dual-pane');

    const leftPane = this.containerEl.createDiv({ cls: 'avm-left-pane' });
    this.renderVersionList(leftPane);

    const rightPane = this.containerEl.createDiv({ cls: 'avm-right-pane' });
    this.renderProjectList(rightPane);
  }

  private renderVersionList(container: HTMLElement) {
    container.empty();

    const header = container.createDiv({ cls: 'avm-pane-header' });
    header.createEl('h3', { text: '版本列表' });

    new ButtonComponent(header)
      .setIcon('plus')
      .setTooltip('新建版本')
      .onClick(() => {
        this.onCreateVersion();
      });

    const versionList = container.createDiv({ cls: 'avm-version-list' });

    const activeVersions = this.versions.filter((v) => !v.isArchived);
    const archivedVersions = this.versions.filter((v) => v.isArchived);

    activeVersions.forEach((version) => {
      this.renderVersionItem(versionList, version);
    });

    if (archivedVersions.length > 0) {
      const archivedHeader = versionList.createDiv({ cls: 'avm-archived-header' });
      archivedHeader.createEl('span', { text: `已归档 (${archivedVersions.length})` });

      archivedVersions.forEach((version) => {
        this.renderVersionItem(versionList, version, true);
      });
    }

    if (this.versions.length === 0) {
      versionList.createDiv({ cls: 'avm-empty-state', text: '暂无版本，点击右上角添加' });
    }
  }

  private renderVersionItem(container: HTMLElement, version: Version, isArchived: boolean = false) {
    const item = container.createDiv({
      cls: `avm-version-item ${this.selectedVersionId === version.id ? 'avm-selected' : ''} ${isArchived ? 'avm-archived' : ''}`,
    });

    item.createDiv({ cls: 'avm-version-number', text: version.versionNumber });

    const meta = item.createDiv({ cls: 'avm-version-meta' });
    const versionProjects = this.projects.filter((p) => p.versionId === version.id);
    const projectCount = versionProjects.length;
    meta.createSpan({ text: `${projectCount} 个项目` });

    // 计算延期统计
    const warningDays = this.plugin.settings.overdueWarningDays;
    const stats = calculateOverdueStats(versionProjects, this.plugin.settings.progressStages, warningDays);

    if (stats.overdue > 0) {
      const overdueBadge = meta.createSpan({
        cls: 'avm-version-badge avm-version-badge-overdue',
        text: `${stats.overdue} 延期`,
      });
      overdueBadge.style.color = '#ef4444';
      overdueBadge.style.fontWeight = '500';
      overdueBadge.style.marginLeft = '6px';
    }

    if (stats.warning > 0) {
      const warningBadge = meta.createSpan({
        cls: 'avm-version-badge avm-version-badge-warning',
        text: `${stats.warning} 预警`,
      });
      warningBadge.style.color = '#f59e0b';
      warningBadge.style.fontWeight = '500';
      warningBadge.style.marginLeft = '6px';
    }

    item.addEventListener('click', () => {
      this.onVersionSelect(version.id);
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showVersionContextMenu(version, e, isArchived);
    });
  }

  private showVersionContextMenu(version: Version, event: MouseEvent, isArchived: boolean) {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle('编辑')
        .setIcon('pencil')
        .onClick(() => this.showEditVersionModal(version)),
    );

    if (isArchived) {
      menu.addItem((item) =>
        item
          .setTitle('取消归档')
          .setIcon('archive')
          .onClick(async () => {
            await this.plugin.dataService.unarchiveVersion(version.id);
            this.onRefresh();
          }),
      );
    } else {
      menu.addItem((item) =>
        item
          .setTitle('归档')
          .setIcon('archive')
          .onClick(async () => {
            await this.plugin.dataService.archiveVersion(version.id);
            this.onRefresh();
          }),
      );
    }

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle('删除')
        .setIcon('trash')
        .onClick(() => {
          new ConfirmModal(
            this.plugin.app,
            '删除版本',
            `确定要删除版本 ${version.versionNumber} 吗？\n关联的项目将保留但解除关联。`,
            async () => {
              try {
                await this.plugin.dataService.deleteVersion(version.id);
                this.onRefresh();
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

  private showEditVersionModal(version: Version) {
    new EditVersionModal(this.plugin.app, version, async (data) => {
      try {
        await this.plugin.dataService.updateVersion(version.id, data, version.version);
        this.onRefresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private renderProjectList(container: HTMLElement) {
    container.empty();

    const header = container.createDiv({ cls: 'avm-pane-header' });
    header.createEl('h3', { text: '项目列表' });

    if (this.selectedVersionId) {
      new ButtonComponent(header)
        .setIcon('plus')
        .setTooltip('新建项目')
        .onClick(() => {
          this.onCreateProject();
        });
    }

    const projectList = container.createDiv({ cls: 'avm-project-list' });

    if (!this.selectedVersionId) {
      projectList.createDiv({ cls: 'avm-empty-state', text: '请选择一个版本查看项目' });
      return;
    }

    const versionProjects = this.projects.filter((p) => p.versionId === this.selectedVersionId);

    if (versionProjects.length === 0) {
      projectList.createDiv({ cls: 'avm-empty-state', text: '暂无项目，点击右上角添加' });
      return;
    }

    const sortedProjects = this.applySorting(versionProjects);

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

    // 添加高亮样式（今天或明天）
    if (this.isProjectHighlighted(project)) {
      item.addClass('avm-highlighted-row');
    }

    // 预发布横幅：项目到达预发布轮次后醒目提示
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

    // Add todo badge（仅展示，点击通过右键菜单「项目待办」入口）
    const todoBadge = header.createDiv({ cls: 'avm-todo-badge', text: '📋' });
    this.getTodoStats(project.id)
      .then((stats) => {
        if (stats.total > 0) {
          todoBadge.setText(`${stats.completed}/${stats.total}`);
          if (stats.overdue > 0) todoBadge.addClass('has-overdue');
        }
      })
      .catch(console.error);

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
    // 为不同 B 轮设置不同颜色（集中定义在 types.ts 的 ROUND_COLORS）
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

class EditVersionModal extends Modal {
  version: Version;
  onSubmit: (data: Partial<Version>) => void;

  constructor(app: ObsidianApp, version: Version, onSubmit: (data: Partial<Version>) => void) {
    super(app);
    this.version = version;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');

    contentEl.createEl('h2', { text: '编辑版本' });

    const data = {
      versionNumber: this.version.versionNumber,
      bllVersion: this.version.bllVersion,
      ippVersion: this.version.ippVersion,
      webVersion: this.version.webVersion,
      updateContent: this.version.updateContent,
    };

    new Setting(contentEl)
      .setName('APP版本号 *')
      .addText((text) => text.setValue(data.versionNumber).onChange((value) => (data.versionNumber = value)));

    new Setting(contentEl)
      .setName('BLL版本 *')
      .addText((text) => text.setValue(data.bllVersion).onChange((value) => (data.bllVersion = value)));

    new Setting(contentEl)
      .setName('IPP版本 *')
      .addText((text) => text.setValue(data.ippVersion).onChange((value) => (data.ippVersion = value)));

    new Setting(contentEl)
      .setName('Web版本 *')
      .addText((text) => text.setValue(data.webVersion).onChange((value) => (data.webVersion = value)));

    new Setting(contentEl)
      .setName('更新内容')
      .addTextArea((text) => text.setValue(data.updateContent).onChange((value) => (data.updateContent = value)));

    createSaveButtons(
      contentEl,
      () => {
        if (data.versionNumber && data.bllVersion && data.ippVersion && data.webVersion) {
          this.onSubmit(data);
          this.close();
        }
      },
      () => this.close(),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
