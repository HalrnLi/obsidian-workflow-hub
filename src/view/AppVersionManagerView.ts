import { ItemView, WorkspaceLeaf, App as ObsidianApp, Setting, ButtonComponent, Notice, Menu, TFile } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import { App, Version, Project, ProjectProgress, SavedFilter, getProgressOrder, getProgressColors } from '../types';
import { DualPaneView } from './DualPaneView';
import { TableView } from './TableView';
import { TodoTabView } from './TodoTabView';
import { ConfirmModal } from './ConfirmModal';
import { EditProjectModal } from './EditProjectModal';
import { TestPlanModal } from './modals/TestPlanModal';
import { ProjectInfoModal } from './modals/ProjectInfoModal';
import { ProjectTodosModal } from './modals/ProjectTodosModal';
import { ImportExportService } from '../services/ImportExportService';
import { openExternalLink } from '../utils/linkUtils';
import { checkOverdue, isProjectHighlighted, sortProjectsByPriority } from '../utils/projectSorting';
import {
  CreateAppModal,
  RenameAppModal,
  CreateVersionModal,
  CreateProjectModal,
  DeleteFilterModal,
  ExportModal,
  ImportModal,
} from './modals';
import type { CreateProjectData } from './modals';

export const VIEW_TYPE_APP_VERSION_MANAGER = 'app-version-manager-view';

type ViewType = 'dual' | 'table';

export class AppVersionManagerView extends ItemView {
  plugin: AppVersionManagerPlugin;
  apps: App[] = [];
  versions: Version[] = [];
  projects: Project[] = [];
  /** 全量项目（不受 version 过滤影响），用于归档视图等需要跨 version 查询的场景 */
  allProjects: Project[] = [];
  selectedAppId: string | null = null;
  selectedVersionId: string | null = null;
  currentView: ViewType = 'dual';
  currentTab: 'projects' | 'todos' = 'projects';
  /** 项目子 Tab：进行中 / 已发布 */
  projectSubTab: 'active' | 'archived' = 'active';
  savedFilters: SavedFilter[] = [];
  currentFilter: { progress: ProjectProgress | null; keyword: string } = { progress: null, keyword: '' };
  importExportService: ImportExportService;
  private todoTabView: TodoTabView | null = null;
  private detailProjectId: string | null = null;
  private detailTab: 'info' | 'todos' = 'info';

  private viewContainerEl: HTMLElement;
  private headerEl: HTMLElement;
  private mainEl: HTMLElement;
  private searchDebounceTimer: number | null = null;
  private autoRefreshTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AppVersionManagerPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.importExportService = new ImportExportService(this.app, this.plugin);
    this.loadSavedFilters();
  }

  getViewType(): string {
    return VIEW_TYPE_APP_VERSION_MANAGER;
  }

  getDisplayText(): string {
    return '工作流中心';
  }

  getIcon(): string {
    return 'layers';
  }

  async onOpen() {
    this.renderLoading();
    try {
      await this.loadData();
      this.render();
    } catch (error) {
      this.renderError(error instanceof Error ? error.message : String(error));
    }
    this.startAutoRefresh();
  }

  private renderLoading() {
    this.containerEl.empty();
    this.containerEl.addClass('app-version-manager');
    const loadingEl = this.containerEl.createDiv({ cls: 'avm-loading' });
    loadingEl.createEl('span', { text: '加载中...' });
  }

  private renderError(message: string) {
    this.containerEl.empty();
    this.containerEl.addClass('app-version-manager');
    const errorEl = this.containerEl.createDiv({ cls: 'avm-error' });
    errorEl.createEl('p', { text: `加载失败: ${message}` });
    const retryBtn = errorEl.createEl('button', { text: '重试' });
    retryBtn.addEventListener('click', () => this.refresh());
  }

  private async loadData() {
    this.apps = await this.plugin.dataService.getAllApps();

    if (this.apps.length > 0) {
      if (!this.selectedAppId || !this.apps.find((a) => a.id === this.selectedAppId)) {
        this.selectedAppId = this.plugin.settings.defaultAppId || this.apps[0].id;
      }

      this.versions = await this.plugin.dataService.getVersionsByAppId(this.selectedAppId);
      // 全量项目（不受 version 过滤影响），用于归档视图等需要跨 version 查询的场景
      const allProjects = await this.plugin.dataService.getAllProjects();
      this.allProjects = allProjects;
      // 只保留当前 app 关联的 projects（用 Set 过滤，避免 O(n*m) 的 .includes()）
      const versionIds = new Set(this.versions.map((v) => v.id));
      this.projects = allProjects.filter((p) => versionIds.has(p.versionId));
    }
  }

  private async loadSavedFilters() {
    const data = (await this.plugin.loadData()) || {};
    this.savedFilters = data.savedFilters || [];
  }

  private async saveSavedFilters() {
    const data = (await this.plugin.loadData()) || {};
    data.savedFilters = this.savedFilters;
    await this.plugin.saveData(data);
  }

  handleCreateVersion() {
    if (this.selectedAppId) {
      this.showCreateVersionModal();
    }
  }

  handleCreateProject() {
    if (this.selectedVersionId) {
      this.showCreateProjectModal();
    }
  }

  async getTodoStats(projectId: string): Promise<{ total: number; completed: number; overdue: number }> {
    try {
      return await this.plugin.todoService.getProjectTodoStats(projectId);
    } catch (error) {
      console.error('Failed to get todo stats:', error);
      return { total: 0, completed: 0, overdue: 0 };
    }
  }

  /** 打开/切换项目详情面板（替代原 TodoSidePanel 侧边弹窗） */
  onOpenProjectDetail(projectId: string, _projectName: string): void {
    this.detailProjectId = projectId;
    this.renderMainView();
  }

  /** 关闭项目详情面板 */
  onCloseProjectDetail(): void {
    this.detailProjectId = null;
    this.renderMainView();
  }

  async refresh() {
    await this.loadData();
    this.render();
  }

  private render() {
    this.containerEl.empty();
    this.containerEl.addClass('app-version-manager');

    try {
      this.headerEl = this.containerEl.createDiv({ cls: 'avm-header' });
      this.renderHeader();

      this.mainEl = this.containerEl.createDiv({ cls: 'avm-main' });
      this.renderMainView();
    } catch (error) {
      this.renderError(error instanceof Error ? error.message : String(error));
    }
  }

  /** 仅更新 tab bar 的 active 状态，不重建整个 header */
  private updateTabBar(): void {
    const tabBar = this.headerEl?.querySelector('.avm-tab-bar');
    if (!tabBar) return;
    const tabs = tabBar.querySelectorAll('.avm-tab');
    tabs.forEach((tab, i) => {
      const keys: Array<'projects' | 'todos'> = ['projects', 'todos'];
      const isActive = keys[i] === this.currentTab;
      tab.classList.toggle('avm-tab-active', isActive);
    });
  }

  private renderHeader() {
    this.headerEl.empty();

    // 主 Tab 切换栏：项目 | 待办
    const tabBar = this.headerEl.createDiv({ cls: 'avm-tab-bar' });
    const tabs: { key: 'projects' | 'todos'; label: string }[] = [
      { key: 'projects', label: '项目' },
      { key: 'todos', label: '待办' },
    ];
    tabs.forEach(({ key, label }) => {
      const tabEl = tabBar.createDiv({ cls: 'avm-tab' + (this.currentTab === key ? ' avm-tab-active' : '') });
      tabEl.setText(label);
      tabEl.addEventListener('click', () => {
        if (this.currentTab !== key) {
          this.currentTab = key;
          this.renderHeader();
          this.renderMainView();
        }
      });
    });

    // 待办 Tab 不需要应用选择器和视图切换器
    if (this.currentTab === 'todos') {
      return;
    }

    // 项目 Tab：子 Tab（进行中 / 已发布）
    const subTabBar = this.headerEl.createDiv({ cls: 'avm-sub-tab-bar' });
    const subTabs: { key: 'active' | 'archived'; label: string }[] = [
      { key: 'active', label: '进行中' },
      { key: 'archived', label: '已发布' },
    ];
    subTabs.forEach(({ key, label }) => {
      const tabEl = subTabBar.createDiv({ cls: 'avm-tab' + (this.projectSubTab === key ? ' avm-tab-active' : '') });
      tabEl.setText(label);
      tabEl.addEventListener('click', () => {
        if (this.projectSubTab !== key) {
          this.projectSubTab = key;
          this.detailProjectId = null;
          this.renderHeader();
          this.renderMainView();
        }
      });
    });

    // 已发布子 Tab：仅显示搜索栏，隐藏 APP 选择器/视图切换/筛选器等
    if (this.projectSubTab === 'archived') {
      this.renderArchivedSearchBar();
      return;
    }

    const topBar = this.headerEl.createDiv({ cls: 'avm-top-bar' });

    const appSelector = topBar.createDiv({ cls: 'avm-app-selector' });
    const select = appSelector.createEl('select', { cls: 'avm-select' });

    this.apps.forEach((app) => {
      const option = select.createEl('option', { value: app.id, text: app.name });
      if (app.id === this.selectedAppId) {
        option.selected = true;
      }
    });

    select.addEventListener('change', async (e) => {
      this.selectedAppId = (e.target as HTMLSelectElement).value;
      this.selectedVersionId = null;
      await this.refresh();
    });

    const appActions = appSelector.createDiv({ cls: 'avm-app-actions' });

    new ButtonComponent(appActions)
      .setIcon('plus')
      .setTooltip('新建APP')
      .onClick(() => this.showCreateAppModal());

    new ButtonComponent(appActions)
      .setIcon('pencil')
      .setTooltip('重命名APP')
      .setDisabled(!this.selectedAppId)
      .onClick(() => {
        if (this.selectedAppId) {
          this.showRenameAppModal();
        }
      });

    new ButtonComponent(appActions)
      .setIcon('trash')
      .setTooltip('删除APP')
      .setDisabled(!this.selectedAppId)
      .onClick(() => {
        if (this.selectedAppId) {
          this.confirmDeleteApp();
        }
      });

    const viewSwitcher = topBar.createDiv({ cls: 'avm-view-switcher' });

    const viewTypes: { type: ViewType; label: string; icon: string }[] = [
      { type: 'dual', label: '双栏视图', icon: 'layout' },
      { type: 'table', label: '表格视图', icon: 'table' },
    ];

    viewTypes.forEach(({ type, label, icon }) => {
      const btn = new ButtonComponent(viewSwitcher)
        .setIcon(icon)
        .setTooltip(label)
        .onClick(() => {
          this.currentView = type;
          this.renderHeader();
          this.renderMainView();
        });
      if (this.currentView === type) {
        btn.setClass('avm-view-btn-active');
      }
    });

    const filterBar = this.headerEl.createDiv({ cls: 'avm-filter-bar' });

    const searchInput = filterBar.createEl('input', {
      cls: 'avm-search-input',
      attr: { type: 'text', placeholder: '搜索项目、项目经理、负责人、项目需求...' },
    });
    searchInput.value = this.currentFilter.keyword;
    searchInput.addEventListener('input', (e) => {
      this.currentFilter.keyword = (e.target as HTMLInputElement).value;
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      this.searchDebounceTimer = window.setTimeout(() => {
        this.renderMainView();
      }, 180);
    });

    const progressFilter = filterBar.createEl('select', { cls: 'avm-select' });
    progressFilter.createEl('option', { value: '', text: '全部进度' });
    const progressOrder = getProgressOrder(this.plugin.settings.progressStages);
    progressOrder.forEach((progress) => {
      const option = progressFilter.createEl('option', { value: progress, text: progress });
      if (progress === this.currentFilter.progress) {
        option.selected = true;
      }
    });
    progressFilter.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      this.currentFilter.progress = (value as ProjectProgress) || null;
      this.renderMainView();
    });

    const filterActions = filterBar.createDiv({ cls: 'avm-filter-actions' });

    new ButtonComponent(filterActions)
      .setIcon('save')
      .setTooltip('保存筛选条件')
      .onClick(() => this.showSaveFilterModal());

    if (this.savedFilters.length > 0) {
      const savedFilterSelect = filterActions.createEl('select', { cls: 'avm-select avm-saved-filter' });
      savedFilterSelect.createEl('option', { value: '', text: '已保存的筛选' });
      this.savedFilters.forEach((filter) => {
        savedFilterSelect.createEl('option', { value: filter.id, text: filter.name });
      });
      savedFilterSelect.addEventListener('change', (e) => {
        const filterId = (e.target as HTMLSelectElement).value;
        if (filterId) {
          this.applySavedFilter(filterId);
        }
      });

      new ButtonComponent(filterActions)
        .setIcon('trash')
        .setTooltip('删除筛选')
        .onClick(() => {
          if (this.savedFilters.length === 0) {
            new Notice('没有可删除的筛选条件');
            return;
          }
          new DeleteFilterModal(
            this.app,
            this.savedFilters,
            async (filterId) => {
              this.savedFilters = this.savedFilters.filter((f) => f.id !== filterId);
              await this.saveSavedFilters();
            },
            () => {
              this.render();
            },
          ).open();
        });
    }

    const actionButtons = filterBar.createDiv({ cls: 'avm-action-buttons' });

    new ButtonComponent(actionButtons)
      .setIcon('download')
      .setTooltip('导出数据')
      .onClick(() => this.showExportModal());

    new ButtonComponent(actionButtons)
      .setIcon('upload')
      .setTooltip('导入数据')
      .onClick(() => this.showImportModal());

    new ButtonComponent(actionButtons)
      .setIcon('refresh-cw')
      .setTooltip('刷新')
      .onClick(() => this.refresh());
  }

  /** 已发布子 Tab 的简化搜索栏 */
  private renderArchivedSearchBar(): void {
    const filterBar = this.headerEl.createDiv({ cls: 'avm-filter-bar' });
    const searchInput = filterBar.createEl('input', {
      cls: 'avm-search-input',
      attr: { type: 'text', placeholder: '搜索已归档项目...' },
    });
    searchInput.value = this.currentFilter.keyword;
    searchInput.addEventListener('input', (e) => {
      this.currentFilter.keyword = (e.target as HTMLInputElement).value;
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      this.searchDebounceTimer = window.setTimeout(() => {
        this.renderMainView();
      }, 180);
    });
  }

  private renderMainView() {
    this.mainEl.empty();
    this.mainEl.removeClass('avm-archived-main');
    // 设置 data-tab 属性，供 CSS 针对不同 Tab 做布局
    this.mainEl.setAttribute('data-tab', this.currentTab);

    if (this.currentTab === 'todos') {
      this.todoTabView = new TodoTabView(this.mainEl, this.plugin, () => this.refresh());
      this.todoTabView.render();
      return;
    }

    // 项目 Tab：已发布子 Tab — 有选中项目时右侧滑出详情面板
    if (this.currentTab === 'projects' && this.projectSubTab === 'archived') {
      if (this.detailProjectId) {
        this.renderArchivedWithDetail();
      } else {
        this.renderArchivedView();
      }
      return;
    }

    // 项目 Tab：进行中子 Tab - 如果有选中的项目，右侧滑出详情面板
    if (this.detailProjectId) {
      this.renderProjectWithDetail();
      return;
    }

    const appFilteredProjects = this.getFilteredProjects({ versionId: '' });
    const filteredVersions = this.selectedAppId ? this.versions.filter((v) => v.appId === this.selectedAppId) : [];

    if (this.currentView === 'dual') {
      new DualPaneView(
        this.mainEl,
        this.plugin,
        this.apps,
        filteredVersions,
        appFilteredProjects,
        this.selectedVersionId,
        (versionId) => {
          this.selectedVersionId = versionId;
          this.render();
        },
        () => this.showCreateVersionModal(),
        () => this.showCreateProjectModal(),
        () => this.refresh(),
        (projectId) => this.getTodoStats(projectId),
        (projectId, projectName) => this.onOpenProjectDetail(projectId, projectName),
      );
    } else if (this.currentView === 'table') {
      new TableView(
        this.mainEl,
        this.plugin,
        appFilteredProjects,
        filteredVersions,
        this.apps,
        () => this.refresh(),
        (projectId) => this.getTodoStats(projectId),
        (projectId, projectName) => this.onOpenProjectDetail(projectId, projectName),
      );
    }
  }

  /** 渲染项目列表 + 右侧滑出详情面板 */
  private renderProjectWithDetail(): void {
    const projectId = this.detailProjectId;
    if (!projectId) return;

    const wrapper = this.mainEl.createDiv({ cls: 'avm-project-with-detail' });

    // 左侧：项目列表（独立双栏容器）
    const listEl = wrapper.createDiv({ cls: 'avm-project-list-pane' });
    const viewContainer = listEl.createDiv({ cls: 'avm-detail-view-container' });

    const appFilteredProjects = this.getFilteredProjects({ versionId: '' });
    const filteredVersions = this.selectedAppId ? this.versions.filter((v) => v.appId === this.selectedAppId) : [];

    if (this.currentView === 'dual') {
      // 双栏视图下显示详情时，保留版本列表+项目卡片，详情作为第三栏滑出
      new DualPaneView(
        viewContainer,
        this.plugin,
        this.apps,
        filteredVersions,
        appFilteredProjects,
        this.selectedVersionId,
        (versionId) => {
          this.selectedVersionId = versionId;
          this.render();
        },
        () => this.showCreateVersionModal(),
        () => this.showCreateProjectModal(),
        () => this.refresh(),
        (projectId) => this.getTodoStats(projectId),
        (projectId, projectName) => this.onOpenProjectDetail(projectId, projectName),
      );
    } else if (this.currentView === 'table') {
      new TableView(
        listEl,
        this.plugin,
        appFilteredProjects,
        filteredVersions,
        this.apps,
        () => this.refresh(),
        (projectId) => this.getTodoStats(projectId),
        (projectId, projectName) => this.onOpenProjectDetail(projectId, projectName),
      );
    }

    // 右侧：项目详情面板
    const detailEl = wrapper.createDiv({ cls: 'avm-project-detail-pane' });
    const project = this.projects.find((p) => p.id === projectId);
    if (project) {
      this.renderProjectDetailContent(detailEl, project);
    }
  }

  /** 仅渲染项目卡片（无版本列表，用于详情模式下的双栏视图） */
  private renderProjectCardsOnly(container: HTMLElement, projects: Project[]): void {
    const header = container.createDiv({ cls: 'avm-pane-header' });
    header.createEl('h3', { text: '项目列表' });
    if (this.selectedVersionId) {
      new ButtonComponent(header).setIcon('plus').setTooltip('新建项目').onClick(() => this.showCreateProjectModal());
    }

    const projectList = container.createDiv({ cls: 'avm-project-list' });

    if (!this.selectedVersionId) {
      projectList.createDiv({ cls: 'avm-empty-state', text: '请选择一个版本查看项目' });
      return;
    }

    const versionProjects = projects.filter((p) => p.versionId === this.selectedVersionId);
    if (versionProjects.length === 0) {
      projectList.createDiv({ cls: 'avm-empty-state', text: '暂无项目，点击右上角添加' });
      return;
    }

    const sortedProjects = sortProjectsByPriority(versionProjects, this.plugin.settings.progressStages);
    sortedProjects.forEach((project) => {
      const isActive = project.id === this.detailProjectId;
      const item = projectList.createDiv({ cls: 'avm-project-item' + (isActive ? ' avm-project-item-active' : '') });

      if (isProjectHighlighted(project, this.plugin.settings.overdueWarningDays)) {
        item.addClass('avm-highlighted-row');
      }

      const headerRow = item.createDiv({ cls: 'avm-project-header' });
      const nameEl = headerRow.createDiv({ cls: 'avm-project-name', text: project.name });
      nameEl.addEventListener('click', () => this.onOpenProjectDetail(project.id, project.name));

      const progressColors = getProgressColors(this.plugin.settings.progressStages);
      const progressBadge = headerRow.createDiv({ cls: 'avm-progress-badge', text: project.progress });
      progressBadge.style.backgroundColor = progressColors[project.progress] || '#64748b';

      if (project.features) {
        item.createDiv({ cls: 'avm-project-features', text: project.features.substring(0, 60) + (project.features.length > 60 ? '...' : '') });
      }

      const meta = item.createDiv({ cls: 'avm-project-meta' });
      if (project.manager) meta.createSpan({ cls: 'avm-meta-item', text: `👤 ${project.manager}` });
    });
  }

  /** 渲染项目详情内容（只读、全信息、可选中复制） */
  private async renderProjectDetailContent(wrapper: HTMLElement, project: Project) {
    // 顶部：返回按钮
    const header = wrapper.createDiv({ cls: 'avm-project-detail-header' });
    new ButtonComponent(header).setIcon('arrow-left').setButtonText('返回').onClick(() => this.onCloseProjectDetail());
    header.createEl('h3', { text: project.name });

    // 只读信息区（可选中复制）
    const content = wrapper.createDiv({ cls: 'avm-project-readonly' });

    const addLine = (label: string, value: string) => {
      if (!value) return;
      const row = content.createDiv({ cls: 'avm-readonly-row' });
      row.createSpan({ cls: 'avm-readonly-label', text: label });
      row.createSpan({ cls: 'avm-readonly-value', text: value });
    };

    const addSection = (title: string) => {
      content.createEl('h4', { text: title, cls: 'avm-readonly-section' });
    };

    // 基本信息
    addSection('基本信息');
    addLine('项目名称', project.name);
    addLine('项目经理', project.manager);
    addLine('负责人', project.responsiblePerson);
    addLine('当前进度', project.progress);
    addLine('项目链接', project.projectLink);
    addLine('组件库链接', project.componentLink);

    // 需求与规格
    if (project.features || project.spec || project.requirements) {
      addSection('需求与规格');
      addLine('特性', project.features);
      addLine('配置组件/规格', project.spec);
      addLine('项目需求', project.requirements);
    }

    // 提测计划
    const hasTestPlan = project.b1IntegrationTestTime || project.b1SystemTestTime ||
      project.b2IntegrationTestTime || project.b2SystemTestTime ||
      project.b3IntegrationTestTime || project.b3SystemTestTime ||
      project.b4IntegrationTestTime || project.b4SystemTestTime || project.actualReleaseTime;
    if (hasTestPlan) {
      addSection('提测计划');
      addLine('B1集成测试', project.b1IntegrationTestTime);
      addLine('B1系统测试', project.b1SystemTestTime);
      addLine('B2集成测试', project.b2IntegrationTestTime);
      addLine('B2系统测试', project.b2SystemTestTime);
      addLine('B3集成测试', project.b3IntegrationTestTime);
      addLine('B3系统测试', project.b3SystemTestTime);
      addLine('B4集成测试', project.b4IntegrationTestTime);
      addLine('B4系统测试', project.b4SystemTestTime);
      addLine('实际发布时间', project.actualReleaseTime);
    }

    // 进度历史
    if (project.progressHistory.length > 0) {
      addSection('进度历史');
      project.progressHistory.forEach((h) => {
        addLine(h.progress, h.changedAt);
      });
    }

    // 项目信息条目
    if (project.projectInfo.length > 0) {
      addSection('项目信息');
      project.projectInfo.forEach((item, i) => {
        const text = item.link ? `${item.description} (${item.link})` : item.description;
        addLine(`条目 ${i + 1}`, text);
      });
    }

    // 待办统计
    try {
      const stats = await this.plugin.todoService.getProjectTodoStats(project.id);
      if (stats.total > 0) {
        addSection('项目待办');
        addLine('待办总数', `${stats.total}`);
        addLine('已完成', `${stats.completed}`);
        addLine('逾期', `${stats.overdue}`);
      }
    } catch {
      // ignore
    }

    // 元数据
    addSection('元数据');
    addLine('创建时间', project.createdAt);
    addLine('更新时间', project.updatedAt);
    addLine('版本号', String(project.version));
  }

  private getFilteredProjects(options?: { versionId?: string }): Project[] {
    // this.projects 已在 loadData() 中按 app 过滤，无需再次过滤 appVersionIds
    let projects = this.projects;

    // 排除已归档项目（最后一个进度阶段）
    const lastProgress = getProgressOrder(this.plugin.settings.progressStages).at(-1);
    if (lastProgress) {
      projects = projects.filter((p) => p.progress !== lastProgress);
    }

    const versionFilter = options?.versionId ?? this.selectedVersionId;
    if (versionFilter) {
      projects = projects.filter((p) => p.versionId === versionFilter);
    }

    if (this.currentFilter.progress) {
      projects = projects.filter((p) => p.progress === this.currentFilter.progress);
    }

    if (this.currentFilter.keyword) {
      projects = this.filterProjectsByKeyword(projects, this.currentFilter.keyword);
    }

    return projects;
  }

  private showCreateAppModal() {
    new CreateAppModal(this.app, async (name) => {
      try {
        await this.plugin.dataService.createApp(name);
        await this.refresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private showRenameAppModal() {
    const app = this.apps.find((a) => a.id === this.selectedAppId);
    if (!app) return;

    new RenameAppModal(this.app, app.name, async (newName) => {
      try {
        await this.plugin.dataService.updateApp(this.selectedAppId!, newName, app.version);
        await this.refresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private async confirmDeleteApp() {
    const app = this.apps.find((a) => a.id === this.selectedAppId);
    if (!app) return;

    new ConfirmModal(
      this.app,
      '删除APP',
      `确定要删除APP "${app.name}" 吗？\n这将同时删除该APP下的所有版本和项目数据！`,
      async () => {
        try {
          await this.plugin.dataService.deleteApp(this.selectedAppId!);
          this.selectedAppId = this.apps.length > 1 ? this.apps.find((a) => a.id !== this.selectedAppId)?.id || null : null;
          await this.refresh();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      },
      undefined,
      true,
    ).open();
  }

  private showCreateVersionModal() {
    if (!this.selectedAppId) return;

    new CreateVersionModal(this.app, async (data) => {
      try {
        await this.plugin.dataService.createVersion({
          appId: this.selectedAppId!,
          ...data,
        });
        await this.refresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private showCreateProjectModal() {
    if (!this.selectedVersionId) return;

    new CreateProjectModal(this.app, this.selectedVersionId, this.plugin.settings.progressStages, this.plugin.settings.responsiblePersons, async (data) => {
      try {
        await this.plugin.dataService.createProject(data);
        await this.refresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private async showSaveFilterModal() {
    const keyword = this.currentFilter.keyword.trim();
    if (!keyword) return;

    const filter: SavedFilter = {
      id: Date.now().toString(),
      name: keyword,
      appId: this.selectedAppId,
      versionId: this.selectedVersionId,
      progress: this.currentFilter.progress,
      keyword: this.currentFilter.keyword,
    };
    this.savedFilters.push(filter);
    await this.saveSavedFilters();
    this.render();
  }

  private async applySavedFilter(filterId: string) {
    const filter = this.savedFilters.find((f) => f.id === filterId);
    if (!filter) return;

    this.selectedAppId = filter.appId;
    this.selectedVersionId = filter.versionId;
    this.currentFilter.progress = filter.progress;
    this.currentFilter.keyword = filter.keyword;

    await this.refresh();
  }

  private async deleteSavedFilter(filterId: string) {
    const filter = this.savedFilters.find((f) => f.id === filterId);
    if (!filter) return;

    new ConfirmModal(this.app, '删除筛选条件', `确定要删除筛选条件 "${filter.name}" 吗？`, async () => {
      this.savedFilters = this.savedFilters.filter((f) => f.id !== filterId);
      await this.saveSavedFilters();
      this.render();
    }).open();
  }

  private showExportModal() {
    new ExportModal(this.app, this.importExportService, this.getFilteredProjects(), this.versions).open();
  }

  private showImportModal() {
    if (!this.selectedAppId) {
      new Notice('请先选择一个APP');
      return;
    }
    new ImportModal(this.app, this.importExportService, this.plugin.backupService, this.selectedAppId, async () => {
      await this.refresh();
    }).open();
  }

  private getArchivedProjects(): Project[] {
    const lastProgress = getProgressOrder(this.plugin.settings.progressStages).at(-1);
    if (!lastProgress) return [];
    // 收集当前 app 关联的归档项目 + 所有进度为最后阶段的归档项目（即使 versionId 已清空）
    const versionIds = new Set(this.versions.map((v) => v.id));
    return this.allProjects.filter(
      (p) => p.progress === lastProgress && (versionIds.has(p.versionId) || !p.versionId),
    );
  }

  private renderArchivedView() {
    const archivedProjects = this.getArchivedProjects();

    if (archivedProjects.length === 0) {
      this.mainEl.createDiv({
        cls: 'avm-empty-state',
        text: '暂无已归档项目',
      });
      return;
    }

    this.mainEl.addClass('avm-archived-main');

    const listContainer = this.mainEl.createDiv({ cls: 'avm-archived-list' });
    const keyword = this.currentFilter.keyword.toLowerCase();
    this.renderArchivedList(archivedProjects, keyword, listContainer);
  }

  /**
   * 按关键词搜索项目（与 getFilteredProjects 搜索范围一致）
   */
  private filterProjectsByKeyword(projects: Project[], keyword: string): Project[] {
    if (!keyword) return projects;
    const kw = keyword.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) ||
        p.manager.toLowerCase().includes(kw) ||
        p.responsiblePerson.toLowerCase().includes(kw) ||
        p.features.toLowerCase().includes(kw) ||
        p.requirements.toLowerCase().includes(kw),
    );
  }

  private renderArchivedList(archivedProjects: Project[], keyword: string, listContainer?: HTMLElement) {
    const container = listContainer || this.mainEl.querySelector('.avm-archived-list') || this.mainEl;
    const existingList = container.querySelector('.avm-archived-items');
    if (existingList) existingList.remove();
    const existingEmpty = container.querySelector('.avm-empty-state');
    if (existingEmpty) existingEmpty.remove();

    const filtered = this.filterProjectsByKeyword(archivedProjects, keyword);

    if (filtered.length === 0) {
      container.createDiv({ cls: 'avm-empty-state', text: '没有找到匹配的项目' });
      return;
    }

    const itemsEl = container.createDiv({ cls: 'avm-archived-items' });
    filtered.forEach((project) => {
      this.renderArchivedProjectCard(itemsEl, project);
    });
  }

  private renderArchivedProjectCard(container: HTMLElement, project: Project) {
    const item = container.createDiv({ cls: 'avm-project-item' });

    if (isProjectHighlighted(project, this.plugin.settings.overdueWarningDays)) {
      item.addClass('avm-highlighted-row');
    }

    // Header: name + progress badge
    const header = item.createDiv({ cls: 'avm-project-header' });
    header.createDiv({ cls: 'avm-project-name', text: project.name });

    const progressColors = getProgressColors(this.plugin.settings.progressStages);
    const progressBadge = header.createDiv({
      cls: 'avm-progress-badge',
      text: project.progress,
    });
    progressBadge.style.backgroundColor = progressColors[project.progress] || '#64748b';

    // Todo badge（仅展示，点击通过右键菜单「项目待办」入口）
    const todoBadge = header.createDiv({ cls: 'avm-todo-badge', text: '📋' });
    this.getTodoStats(project.id)
      .then((stats) => {
        if (stats.total > 0) {
          todoBadge.setText(`${stats.completed}/${stats.total}`);
          if (stats.overdue > 0) todoBadge.addClass('has-overdue');
        }
      })
      .catch(console.error);

    // Features
    if (project.features) {
      const featuresEl = item.createDiv({ cls: 'avm-project-features' });
      featuresEl.createEl('strong', { text: '特性:' });
      featuresEl.createSpan({ text: project.features.substring(0, 100) + (project.features.length > 100 ? '...' : '') });
    }

    // Spec
    if (project.spec) {
      const specEl = item.createDiv({ cls: 'avm-project-spec' });
      specEl.createEl('strong', { text: '配置组件/规格:' });
      specEl.createSpan({ text: project.spec.substring(0, 100) + (project.spec.length > 100 ? '...' : '') });
    }

    // Overdue
    if (checkOverdue(project, this.plugin.settings.progressStages, this.plugin.settings.overdueWarningDays)) {
      item.addClass('avm-overdue');
    }

    // Meta info
    const meta = item.createDiv({ cls: 'avm-project-meta' });
    if (project.manager) {
      meta.createSpan({ cls: 'avm-meta-item', text: `👤 ${project.manager}` });
    }
    const version = this.versions.find((v) => v.id === project.versionId);
    const app = version ? this.apps.find((a) => a.id === version.appId) : null;
    if (app) {
      meta.createSpan({ cls: 'avm-meta-item', text: `📦 ${app.name} / ${version?.versionNumber || '-'}` });
    }
    if (project.actualReleaseTime) {
      meta.createSpan({ cls: 'avm-meta-item', text: `📅 ${project.actualReleaseTime}` });
    }

    // Links
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

    // Requirements
    if (project.requirements) {
      const req = item.createDiv({ cls: 'avm-project-requirements' });
      req.createEl('strong', { text: '需求:' });
      req.createSpan({ text: project.requirements.substring(0, 100) + (project.requirements.length > 100 ? '...' : '') });
    }

    // Context menu
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showArchivedContextMenu(project, e);
    });

    // Double-click to open project detail
    item.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.onOpenProjectDetail(project.id, project.name);
    });
  }

  /** 已发布列表 + 右侧滑出详情面板 */
  private renderArchivedWithDetail(): void {
    const wrapper = this.mainEl.createDiv({ cls: 'avm-project-with-detail' });
    this.mainEl.addClass('avm-archived-main');

    // 左侧：已发布项目列表
    const listEl = wrapper.createDiv({ cls: 'avm-project-list-pane' });

    const archivedProjects = this.getArchivedProjects();
    const keyword = this.currentFilter.keyword.toLowerCase();
    const filtered = keyword
      ? archivedProjects.filter(
          (p) =>
            p.name.toLowerCase().includes(keyword) ||
            p.manager.toLowerCase().includes(keyword) ||
            p.responsiblePerson.toLowerCase().includes(keyword) ||
            p.features.toLowerCase().includes(keyword),
        )
      : archivedProjects;

    const listContainer = listEl.createDiv({ cls: 'avm-archived-list' });
    if (filtered.length === 0) {
      listContainer.createDiv({ cls: 'avm-empty-state', text: '没有找到匹配的项目' });
    } else {
      const itemsEl = listContainer.createDiv({ cls: 'avm-archived-items' });
      filtered.forEach((project) => {
        this.renderArchivedProjectCard(itemsEl, project);
      });
    }

    // 右侧：项目详情面板
    const detailEl = wrapper.createDiv({ cls: 'avm-project-detail-pane' });
    const project = this.projects.find((p) => p.id === this.detailProjectId);
    if (project) {
      this.renderProjectDetailContent(detailEl, project);
    }
  }

  private showArchivedContextMenu(project: Project, event: MouseEvent) {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle('编辑')
        .setIcon('pencil')
        .onClick(() => this.showEditArchivedProject(project)),
    );

    menu.addItem((item) =>
      item
        .setTitle('提测计划')
        .setIcon('calendar')
        .onClick(() => this.openTestPlanModal(project)),
    );

    menu.addItem((item) =>
      item
        .setTitle('项目信息')
        .setIcon('file-text')
        .onClick(() => new ProjectInfoModal(this.app, this.plugin, project, () => this.refresh()).open()),
    );

    menu.addItem((item) =>
      item
        .setTitle('项目待办')
        .setIcon('checkmark')
        .onClick(() => new ProjectTodosModal(this.app, this.plugin, project, () => this.refresh()).open()),
    );

    menu.addItem((item) =>
      item
        .setTitle('项目详情')
        .setIcon('info')
        .onClick(() => this.onOpenProjectDetail(project.id, project.name)),
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
                await this.refresh();
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

  private showEditArchivedProject(project: Project) {
    this.openEditProjectModal(project);
  }

  /** 打开提测计划弹窗 */
  openTestPlanModal(project: Project) {
    new TestPlanModal(this.plugin.app, project, async (testData) => {
      try {
        await this.plugin.dataService.updateProject(project.id, testData, project.version);
        await this.refresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  /** 打开编辑项目弹窗（含提测日期等全部字段） */
  openEditProjectModal(project: Project) {
    new EditProjectModal(this.plugin.app, project, this.apps, this.versions, this.plugin.settings.progressStages, this.plugin.settings.responsiblePersons, async (data) => {
      try {
        await this.plugin.dataService.updateProject(project.id, data, project.version);
        await this.refresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  async onClose() {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    this.stopAutoRefresh();
    this.containerEl.empty();
  }

  private startAutoRefresh() {
    this.stopAutoRefresh();
    const interval = this.plugin.settings.autoRefreshInterval;
    if (interval > 0) {
      const milliseconds = interval * 60 * 1000;
      this.autoRefreshTimer = window.setInterval(() => {
        this.refresh();
      }, milliseconds);
    }
  }

  private stopAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }
}
