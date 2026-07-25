import { App as ObsidianApp, ButtonComponent, Notice, Modal, Setting, Menu } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import { App, Version, Project } from '../types';
import { CreateAppModal, RenameAppModal, CreateVersionModal } from './modals';
import { ConfirmModal } from './ConfirmModal';
import { createSaveButtons } from './ModalUtils';

/**
 * APP/版本管理面板 — 卡片式布局，右键菜单 + 双击详情滑出面板
 */
export class AppVersionManageView {
  containerEl: HTMLElement;
  plugin: AppVersionManagerPlugin;
  apps: App[];
  versions: Version[];
  onRefresh: () => void;
  private detailPanel: HTMLElement | null = null;

  constructor(
    containerEl: HTMLElement,
    plugin: AppVersionManagerPlugin,
    apps: App[],
    versions: Version[],
    onRefresh: () => void,
  ) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.apps = apps;
    this.versions = versions;
    this.onRefresh = onRefresh;
    this.render();
  }

  private render(): void {
    this.containerEl.empty();
    this.containerEl.addClass('avm-app-version-manage');
    this.detailPanel = null;

    // 顶部标题栏
    const header = this.containerEl.createDiv({ cls: 'avm-avm-header' });
    const titleRow = header.createDiv({ cls: 'avm-avm-title-row' });
    titleRow.createEl('h2', { text: 'APP / 版本管理' });

    const headerActions = titleRow.createDiv({ cls: 'avm-avm-header-actions' });
    new ButtonComponent(headerActions)
      .setIcon('plus')
      .setButtonText('新建 APP')
      .onClick(() => this.showCreateAppModal());

    // 内容区（包含主列表 + 详情面板）
    const content = this.containerEl.createDiv({ cls: 'avm-avm-content' });

    if (this.apps.length === 0) {
      content.createDiv({
        cls: 'avm-avm-empty',
        text: '暂无 APP，点击上方「新建 APP」按钮创建',
      });
      return;
    }

    // 主体：APP 卡片列表 + 右侧详情面板
    const body = content.createDiv({ cls: 'avm-avm-body' });
    const cardList = body.createDiv({ cls: 'avm-avm-cards' });
    this.apps.forEach((app) => {
      this.renderAppCard(cardList, app);
    });
  }

  private renderAppCard(container: HTMLElement, app: App): void {
    const card = container.createDiv({ cls: 'avm-avm-card' });

    // APP 标题行
    const cardHeader = card.createDiv({ cls: 'avm-avm-card-header' });

    const titleArea = cardHeader.createDiv({ cls: 'avm-avm-card-title-area' });
    titleArea.createSpan({ cls: 'avm-avm-card-icon', text: '📦' });
    titleArea.createSpan({ cls: 'avm-avm-card-name', text: app.name });

    // 右键菜单：重命名 + 删除 APP
    titleArea.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) => {
        item.setTitle('重命名').setIcon('pencil').onClick(() => this.showRenameAppModal(app));
      });
      menu.addItem((item) => {
        item.setTitle('删除').setIcon('trash').onClick(() => this.confirmDeleteApp(app));
      });
      menu.showAtMouseEvent(e);
    });

    const actions = cardHeader.createDiv({ cls: 'avm-avm-card-actions' });
    // 只保留「添加版本」按钮
    new ButtonComponent(actions)
      .setIcon('plus')
      .setTooltip('添加版本')
      .onClick(() => this.showCreateVersionModal(app));

    // 版本区域
    const versionSection = card.createDiv({ cls: 'avm-avm-card-versions' });
    const appVersions = this.versions
      .filter((v) => v.appId === app.id)
      .sort((a, b) => {
        if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
        return b.versionNumber.localeCompare(a.versionNumber);
      });

    if (appVersions.length === 0) {
      versionSection.createDiv({
        cls: 'avm-avm-no-versions',
        text: '暂无版本，点击右上角 + 添加',
      });
      return;
    }

    // 版本表格
    const versionTable = versionSection.createDiv({ cls: 'avm-avm-version-table' });

    // 表头
    const thead = versionTable.createDiv({ cls: 'avm-avm-version-thead' });
    thead.createSpan({ cls: 'avm-avm-th avm-avm-th-version', text: '版本号' });
    thead.createSpan({ cls: 'avm-avm-th avm-avm-th-components', text: '组件版本' });
    thead.createSpan({ cls: 'avm-avm-th avm-avm-th-projects', text: '项目数' });
    thead.createSpan({ cls: 'avm-avm-th avm-avm-th-actions', text: '' });

    // 版本行
    const tbody = versionTable.createDiv({ cls: 'avm-avm-version-tbody' });
    appVersions.forEach((version) => {
      this.renderVersionRow(tbody, version, app);
    });
  }

  private renderVersionRow(container: HTMLElement, version: Version, app: App): void {
    const row = container.createDiv({
      cls: `avm-avm-version-row ${version.isArchived ? 'avm-avm-version-row-archived' : ''}`,
    });

    // 版本号
    const versionCell = row.createDiv({ cls: 'avm-avm-td avm-avm-td-version' });
    versionCell.createSpan({ cls: 'avm-avm-version-number', text: version.versionNumber });
    if (version.isArchived) {
      versionCell.createSpan({ cls: 'avm-avm-version-archived-badge', text: '已归档' });
    }

    // 组件版本
    const componentsCell = row.createDiv({ cls: 'avm-avm-td avm-avm-td-components' });
    const componentVersions = [version.bllVersion, version.ippVersion, version.webVersion]
      .filter(Boolean)
      .join(' / ');
    componentsCell.createSpan({
      cls: 'avm-avm-component-text',
      text: componentVersions || '—',
    });

    // 关联项目数
    const projectsCell = row.createDiv({ cls: 'avm-avm-td avm-avm-td-projects' });
    const countBadge = projectsCell.createSpan({ cls: 'avm-avm-project-count', text: '...' });
    this.plugin.dataService.getAllProjects().then((projects) => {
      const count = projects.filter((p) => p.appVersionLinks.some((link) => link.versionId === version.id)).length;
      countBadge.setText(`${count} 个`);
    });

    // 操作列：只保留编辑按钮
    const actionsCell = row.createDiv({ cls: 'avm-avm-td avm-avm-td-actions' });
    new ButtonComponent(actionsCell)
      .setIcon('pencil')
      .setTooltip('编辑')
      .onClick(() => this.showEditVersionModal(version, app));

    // 双击打开详情面板
    row.addEventListener('dblclick', () => this.openDetailPanel(version, app));

    // 右键菜单
    row.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      const menu = new Menu();
      if (version.isArchived) {
        menu.addItem((item) => {
          item.setTitle('取消归档').setIcon('archive').onClick(async () => {
            await this.plugin.dataService.unarchiveVersion(version.id);
            this.onRefresh();
          });
        });
      } else {
        menu.addItem((item) => {
          item.setTitle('归档').setIcon('archive').onClick(async () => {
            await this.plugin.dataService.archiveVersion(version.id);
            this.onRefresh();
          });
        });
      }
      menu.addSeparator();
      menu.addItem((item) => {
        item.setTitle('编辑').setIcon('pencil').onClick(() => this.showEditVersionModal(version, app));
      });
      menu.addItem((item) => {
        item.setTitle('查看详情').setIcon('eye').onClick(() => this.openDetailPanel(version, app));
      });
      menu.addSeparator();
      menu.addItem((item) => {
        item.setTitle('删除').setIcon('trash').onClick(() => this.confirmDeleteVersion(version, app));
      });
      menu.showAtMouseEvent(e);
    });
  }

  // === 右侧详情面板 ===

  private openDetailPanel(version: Version, app: App): void {
    // 如果已打开且是同一个版本，则关闭
    if (this.detailPanel && this.detailPanel.dataset.versionId === version.id) {
      this.closeDetailPanel();
      return;
    }

    // 移除旧面板
    if (this.detailPanel) {
      this.detailPanel.remove();
    }

    const body = this.containerEl.querySelector('.avm-avm-body') as HTMLElement;
    if (!body) return;
    body.addClass('avm-avm-body-with-detail');

    // 创建滑出面板
    const panel = body.createDiv({ cls: 'avm-avm-detail-panel' });
    panel.dataset.versionId = version.id;
    this.detailPanel = panel;

    // 面板头部
    const panelHeader = panel.createDiv({ cls: 'avm-avm-detail-header' });
    panelHeader.createEl('h3', { text: version.versionNumber });
    const closeBtn = panelHeader.createSpan({ cls: 'avm-avm-detail-close', text: '✕' });
    closeBtn.addEventListener('click', () => this.closeDetailPanel());

    // 面板内容
    const panelBody = panel.createDiv({ cls: 'avm-avm-detail-body' });

    // APP 信息
    this.renderDetailRow(panelBody, '所属 APP', app.name);

    // 组件版本
    const componentText = [version.bllVersion, version.ippVersion, version.webVersion]
      .filter(Boolean)
      .join(' / ');
    this.renderDetailRow(panelBody, '组件版本', componentText || '—');

    // 更新内容
    const updateSection = panelBody.createDiv({ cls: 'avm-avm-detail-section' });
    updateSection.createDiv({ cls: 'avm-avm-detail-label', text: '更新内容' });
    const updateContent = updateSection.createDiv({ cls: 'avm-avm-detail-update-content' });
    updateContent.setText(version.updateContent || '—');

    // 关联项目列表
    const projectsSection = panelBody.createDiv({ cls: 'avm-avm-detail-section' });
    projectsSection.createDiv({ cls: 'avm-avm-detail-label', text: '关联项目' });
    const projectsList = projectsSection.createDiv({ cls: 'avm-avm-detail-projects' });
    this.plugin.dataService.getAllProjects().then((projects) => {
      const linked = projects.filter((p) => p.appVersionLinks.some((link) => link.versionId === version.id));
      if (linked.length === 0) {
        projectsList.createDiv({ cls: 'avm-avm-detail-empty', text: '暂无关联项目' });
      } else {
        linked.forEach((project) => {
          const item = projectsList.createDiv({ cls: 'avm-avm-detail-project-item' });
          item.createSpan({ cls: 'avm-avm-detail-project-name', text: project.name });
          if (project.progress) {
            const badge = item.createSpan({ cls: 'avm-progress-badge-small', text: project.progress });
            badge.style.setProperty('--progress-color', this.getProgressColor(project.progress));
          }
        });
      }
    });
  }

  private renderDetailRow(container: HTMLElement, label: string, value: string): void {
    const row = container.createDiv({ cls: 'avm-avm-detail-row' });
    row.createSpan({ cls: 'avm-avm-detail-label', text: label });
    row.createSpan({ cls: 'avm-avm-detail-value', text: value });
  }

  private getProgressColor(progress: string): string {
    const colors: Record<string, string> = {
      '待规划': '#94a3b8',
      '开发中': '#3b82f6',
      '测试中': '#f59e0b',
      '已上线': '#10b981',
      '已归档': '#6b7280',
    };
    return colors[progress] || '#94a3b8';
  }

  private closeDetailPanel(): void {
    if (this.detailPanel) {
      this.detailPanel.remove();
      this.detailPanel = null;
      const body = this.containerEl.querySelector('.avm-avm-body') as HTMLElement;
      if (body) body.removeClass('avm-avm-body-with-detail');
    }
  }

  // === Modal 操作 ===

  private showCreateAppModal(): void {
    new CreateAppModal(this.plugin.app, async (name) => {
      try {
        await this.plugin.dataService.createApp(name);
        this.onRefresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private showRenameAppModal(app: App): void {
    new RenameAppModal(this.plugin.app, app.name, async (newName) => {
      try {
        await this.plugin.dataService.updateApp(app.id, newName, app.version);
        this.onRefresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private confirmDeleteApp(app: App): void {
    new ConfirmModal(
      this.plugin.app,
      '删除 APP',
      `确定要删除 APP "${app.name}" 吗？\n该 APP 下的所有版本将被删除，关联项目的对应链接也会被清除。`,
      async () => {
        try {
          await this.plugin.dataService.deleteApp(app.id);
          this.onRefresh();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      },
      undefined,
      true,
    ).open();
  }

  private showCreateVersionModal(app: App): void {
    new CreateVersionModal(this.plugin.app, async (data) => {
      try {
        await this.plugin.dataService.createVersion({
          appId: app.id,
          ...data,
        });
        this.onRefresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private showEditVersionModal(version: Version, app: App): void {
    const modal = new EditVersionModal(this.plugin.app, version, async (data) => {
      try {
        await this.plugin.dataService.updateVersion(version.id, data, version.version);
        this.onRefresh();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    });
    modal.open();
  }

  private confirmDeleteVersion(version: Version, app: App): void {
    new ConfirmModal(
      this.plugin.app,
      '删除版本',
      `确定要删除版本 ${version.versionNumber} 吗？\n关联项目的对应链接将被清除。`,
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
  }
}

// === 编辑版本弹窗 ===

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

    // 更新内容 — 更大的输入框
    const updateSetting = new Setting(contentEl).setName('更新内容');
    const textArea = createTextArea(updateSetting.controlEl, data.updateContent);
    textArea.addEventListener('input', () => {
      data.updateContent = textArea.value;
    });

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

function createTextArea(container: HTMLElement, value: string): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.className = 'avm-avm-textarea-large';
  container.appendChild(textarea);
  return textarea;
}
