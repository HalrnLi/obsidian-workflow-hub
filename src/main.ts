import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Modal, Notice } from 'obsidian';
import { AppVersionManagerView, VIEW_TYPE_APP_VERSION_MANAGER } from './view/AppVersionManagerView';
import { PluginSettings, DEFAULT_SETTINGS, ProgressStage, DEFAULT_PROGRESS_STAGES } from './types';
import { DataService } from './services/DataService';
import { BackupService } from './services/BackupService';
import { TodoService } from './services/TodoService';
import { CategoryService } from './services/CategoryService';
import { MigrationService } from './services/MigrationService';
import { DataConfigService } from './services/DataConfigService';
import { TodoInheritanceService } from './services/TodoInheritanceService';
import { ReminderService } from './services/ReminderService';
import { STYLES } from './styles';

const STYLE_ID = 'workflow-hub-styles';

export default class AppVersionManagerPlugin extends Plugin {
  settings: PluginSettings;
  dataService: DataService;
  backupService: BackupService;
  todoService: TodoService;
  categoryService: CategoryService;
  dataConfigService: DataConfigService;
  private todoInheritanceService: TodoInheritanceService;
  reminderService: ReminderService;
  private saveSettingsQueue: Promise<void> = Promise.resolve();
  private migrationPromise: Promise<void> | null = null;

  async onload() {
    await this.loadSettings();

    this.injectStyles();

    this.dataService = new DataService(this.app, this);
    this.dataConfigService = new DataConfigService(this);
    await this.dataConfigService.load();
    this.backupService = new BackupService(this.app, this);
    this.todoService = new TodoService(this);
    this.categoryService = new CategoryService(this);
    this.todoInheritanceService = new TodoInheritanceService(this);
    this.reminderService = new ReminderService(this);

    // 数据迁移：首次加载且未完成迁移时执行（见 MigrationService）
    if (!this.settings.migrationCompleted) {
      const migration = new MigrationService(this);
      this.migrationPromise = migration.run().catch((e) => {
        console.error('[WorkflowHub] 数据迁移失败:', e);
        new Notice('数据迁移失败，请查看控制台。可在设置中重试。');
      });
    }

    // Unregister first to handle plugin reload (hot-reload / duplicate install)
    (this.app.workspace as any).unregisterViewType?.(VIEW_TYPE_APP_VERSION_MANAGER);
    this.registerView(VIEW_TYPE_APP_VERSION_MANAGER, (leaf) => new AppVersionManagerView(leaf, this));

    this.addRibbonIcon('layers', '工作流中心', () => {
      this.activateView();
    });

    this.addCommand({
      id: 'open-app-version-manager',
      name: '打开工作流中心',
      callback: () => this.activateView(),
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'v' }],
    });

    this.addCommand({
      id: 'create-new-version',
      name: 'Create New Version',
      callback: () => {
        this.app.workspace.trigger('app-version-manager:create-version');
      },
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'n' }],
    });

    this.addCommand({
      id: 'create-new-project',
      name: 'Create New Project',
      callback: () => {
        this.app.workspace.trigger('app-version-manager:create-project');
      },
      hotkeys: [{ modifiers: ['Mod', 'Alt'], key: 'n' }],
    });

    this.addSettingTab(new AppVersionManagerSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.backupService.scheduleBackup();
      this.categoryService.initializeDefaults().catch((e) => console.error('[WorkflowHub] 初始化默认分类失败:', e));
      this.todoService.loadAllIndexes().catch((e) => console.error('[WorkflowHub] 加载待办索引失败:', e));
      this.todoInheritanceService.start();
      // 注册 vault 事件监听，外部修改文件时自动失效索引
      this.todoService.registerVaultEvents();
      this.categoryService.registerVaultEvents();
    });
  }

  /** 等待迁移完成（视图加载数据前调用） */
  async waitForMigration(): Promise<void> {
    if (this.migrationPromise) {
      await this.migrationPromise;
      this.migrationPromise = null;
    }
  }

  onunload() {
    (this.app.workspace as any).unregisterViewType?.(VIEW_TYPE_APP_VERSION_MANAGER);
    // 注销 vault 事件监听，避免热重载后监听器累积
    this.todoService.unregisterVaultEvents();
    this.categoryService.unregisterVaultEvents();
    this.dataService.cache.destroy();
    this.backupService.clearBackupSchedule();
    this.todoInheritanceService.clear();
    this.reminderService.clearAll();
    this.removeStyles();
  }

  /** 通知所有视图刷新（提醒服务回调用） */
  notifyViewsToRefresh(): void {
    this.app.workspace.trigger('app-version-manager:refresh');
  }

  /** 注册视图刷新事件（供视图订阅） */
  registerRefreshHandler(handler: () => void): () => void {
    const evt = (this.app.workspace as any).on('app-version-manager:refresh', handler);
    // 返回取消注册函数
    return () => {
      this.app.workspace.offref(evt);
    };
  }

  injectStyles() {
    const styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);
  }

  removeStyles() {
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) {
      styleEl.remove();
    }
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings() {
    this.saveSettingsQueue = this.saveSettingsQueue
      .catch(() => {
        // Keep the queue alive even if a previous save failed.
      })
      .then(async () => {
        const data = (await this.loadData()) || {};
        Object.assign(data, this.settings);
        await this.saveData(data);
      });
    await this.saveSettingsQueue;
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_APP_VERSION_MANAGER);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeftLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_APP_VERSION_MANAGER,
          active: true,
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
}

class AppVersionManagerSettingTab extends PluginSettingTab {
  plugin: AppVersionManagerPlugin;

  constructor(app: App, plugin: AppVersionManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('数据存储路径')
      .setDesc('设置插件数据存储的根目录路径。支持相对路径（相对于vault根目录）或绝对路径')
      .addText((text) =>
        text
          .setPlaceholder('app-version-manager 或 C:\\MyData\\app-versions')
          .setValue(this.plugin.settings.dataPath)
          .onChange(async (value) => {
            const newPath = value.trim() || 'app-version-manager';
            if (newPath !== this.plugin.settings.dataPath) {
              this.plugin.settings.dataPath = newPath;
              await this.plugin.saveSettings();
              // 销毁旧 DataService 的缓存定时器，再初始化新路径的数据服务
              this.plugin.dataService.cache.destroy();
              this.plugin.dataService = new DataService(this.app, this.plugin);
              // 重置其他服务的路径状态
              this.plugin.todoService.resetPath();
              this.plugin.categoryService.resetPath();
              this.plugin.dataConfigService.reset();
              await this.plugin.dataConfigService.load();
            }
          }),
      );

    new Setting(containerEl)
      .setName('打开数据目录')
      .setDesc('在文件管理器中打开数据存储目录')
      .addButton((btn) =>
        btn.setButtonText('打开数据目录').onClick(() => {
          const dataPath = this.plugin.settings.dataPath;
          if (this.plugin.dataService.isAbsolutePath()) {
            // 对于绝对路径，使用系统默认方式打开文件夹
            // 这里我们不能直接打开，但可以显示路径
            new Notice(`数据存储路径: ${dataPath}\n\n请手动在文件管理器中打开此路径。`);
          } else {
            const dataFolder = this.app.vault.getAbstractFileByPath(dataPath);
            if (dataFolder) {
              const appWithShowInFolder = this.app as App & { showInFolder?: (path: string) => void };
              if (typeof appWithShowInFolder.showInFolder === 'function') {
                appWithShowInFolder.showInFolder(dataFolder.path);
              } else {
                new Notice('当前环境不支持打开系统文件管理器');
              }
            } else {
              new Notice('数据目录尚未创建，请先创建一些数据后再试');
            }
          }
        }),
      );

    new Setting(containerEl)
      .setName('自动备份')
      .setDesc('启用自动每周备份')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoBackup).onChange(async (value) => {
          this.plugin.settings.autoBackup = value;
          await this.plugin.saveSettings();
          if (value) {
            this.plugin.backupService.scheduleBackup();
          } else {
            this.plugin.backupService.clearBackupSchedule();
          }
        }),
      );

    new Setting(containerEl)
      .setName('备份路径')
      .setDesc('备份文件存储路径，不填则默认为笔记根目录下的 app-version-manager/backups 文件夹')
      .addText((text) =>
        text
          .setPlaceholder('app-version-manager/backups 或留空使用默认路径')
          .setValue(this.plugin.settings.backupPath)
          .onChange(async (value) => {
            this.plugin.settings.backupPath = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('手动备份')
      .setDesc('立即创建一个备份文件')
      .addButton((btn) =>
        btn.setButtonText('立即备份').onClick(async () => {
          try {
            const backupPath = await this.plugin.backupService.performBackup();
            new Notice(`备份成功！\n备份文件：${backupPath}`);
          } catch (error) {
            new Notice(`备份失败：${error instanceof Error ? error.message : String(error)}`);
          }
        }),
      );

    new Setting(containerEl)
      .setName('备份日')
      .setDesc('每周备份日（0=周日，5=周五）')
      .addSlider((slider) =>
        slider
          .setLimits(0, 6, 1)
          .setValue(this.plugin.settings.backupDay)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.backupDay = value;
            await this.plugin.saveSettings();
            this.plugin.backupService.scheduleBackup();
          }),
      );

    new Setting(containerEl)
      .setName('备份时间')
      .setDesc('每天备份时间（0-23时）')
      .addSlider((slider) =>
        slider
          .setLimits(0, 23, 1)
          .setValue(this.plugin.settings.backupHour)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.backupHour = value;
            await this.plugin.saveSettings();
            this.plugin.backupService.scheduleBackup();
          }),
      );

    containerEl.createEl('h3', { text: '延期预警设置' });

    new Setting(containerEl)
      .setName('预警天数')
      .setDesc('项目在截止日期前多少天内显示预警（1-14天）')
      .addSlider((slider) =>
        slider
          .setLimits(1, 14, 1)
          .setValue(this.plugin.settings.overdueWarningDays)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.overdueWarningDays = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h3', { text: '项目列表显示列' });

    new Setting(containerEl)
      .setName('显示列配置')
      .setDesc('自定义项目列表中显示哪些列')

    const columnOptions: Array<{ key: string; label: string }> = [
      { key: 'name', label: '项目名称' },
      { key: 'appVersion', label: 'APP / 版本' },
      { key: 'manager', label: '项目经理' },
      { key: 'responsiblePerson', label: '负责人' },
      { key: 'features', label: '特性' },
      { key: 'spec', label: '配置组件/规格' },
      { key: 'progress', label: '进度' },
      { key: 'currentRound', label: '当前阶段' },
      { key: 'nextStage', label: '下一阶段' },
      { key: 'nextStageTime', label: '下一阶段时间' },
      { key: 'links', label: '链接' },
      { key: 'todos', label: '待办' },
    ];

    const currentColumns = this.plugin.dataConfigService.config.tableColumns || [];
    columnOptions.forEach((opt) => {
      new Setting(containerEl)
        .setName(opt.label)
        .addToggle((toggle) =>
          toggle
            .setValue(currentColumns.includes(opt.key))
            .onChange(async (value) => {
              const cols = [...(this.plugin.dataConfigService.config.tableColumns || [])];
              if (value && !cols.includes(opt.key)) {
                cols.push(opt.key);
              } else if (!value && cols.includes(opt.key)) {
                const idx = cols.indexOf(opt.key);
                if (idx >= 0) cols.splice(idx, 1);
              }
              this.plugin.dataConfigService.config.tableColumns = cols;
              await this.plugin.dataConfigService.save();
            }),
        );
    });

    containerEl.createEl('h3', { text: '预发布轮次设置' });

    new Setting(containerEl)
      .setName('预发布轮次')
      .setDesc(
        '设置哪个阶段为预发布轮次。当该阶段或之后的任一时间已过，项目卡片将显示预发布提示。即使中间阶段时间未填，只要后续阶段时间已过即触发。',
      )
      .addDropdown((dropdown) => {
        dropdown.addOption('B2系统测试', 'B2系统测试');
        dropdown.addOption('B3集成测试', 'B3集成测试（默认）');
        dropdown.addOption('B3系统测试', 'B3系统测试');
        dropdown.addOption('B4集成测试', 'B4集成测试');
        dropdown.addOption('B4系统测试', 'B4系统测试');
        dropdown.setValue(this.plugin.dataConfigService.config.preReleaseRound);
        dropdown.onChange(async (value) => {
          this.plugin.dataConfigService.config.preReleaseRound = value;
          await this.plugin.dataConfigService.save();
        });
      });

    containerEl.createEl('h3', { text: '自动刷新设置' });

    new Setting(containerEl)
      .setName('自动刷新间隔')
      .setDesc('自动刷新当前视图数据的时间间隔（0=关闭）')
      .addDropdown((dropdown) => {
        dropdown.addOption('0', '关闭');
        dropdown.addOption('1', '1分钟');
        dropdown.addOption('2', '2分钟');
        dropdown.addOption('5', '5分钟');
        dropdown.setValue(String(this.plugin.settings.autoRefreshInterval));
        dropdown.onChange(async (value) => {
          this.plugin.settings.autoRefreshInterval = parseInt(value);
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl('h3', { text: '项目进度阶段配置' });

    const progressDesc = containerEl.createDiv({ cls: 'avm-progress-desc' });
    progressDesc.style.marginBottom = '12px';
    progressDesc.style.color = 'var(--text-muted)';
    progressDesc.style.fontSize = '13px';
    progressDesc.setText('自定义项目进度的各个阶段名称和颜色。阶段的顺序即为项目流程的顺序。');

    this.renderProgressStagesSettings(containerEl);

    new Setting(containerEl).setName('添加新阶段').addButton((btn) =>
      btn.setButtonText('添加阶段').onClick(async () => {
        const stages = this.plugin.dataConfigService.config.progressStages;
        const newColor = this.generateRandomColor();
        stages.push({ name: `新阶段${stages.length + 1}`, color: newColor });
        this.plugin.dataConfigService.config.progressStages = stages;
        await this.plugin.dataConfigService.save();
        this.display();
      }),
    );

    new Setting(containerEl)
      .setName('重置为默认阶段')
      .setDesc('恢复默认的项目进度阶段配置')
      .addButton((btn) =>
        btn
          .setButtonText('重置')
          .setWarning()
          .onClick(async () => {
            this.plugin.dataConfigService.config.progressStages = JSON.parse(JSON.stringify(DEFAULT_PROGRESS_STAGES));
            await this.plugin.dataConfigService.save();
            this.display();
          }),
      );

    containerEl.createEl('h3', { text: '负责人设置' });

    const responsibleDesc = containerEl.createDiv({ cls: 'avm-responsible-desc' });
    responsibleDesc.style.marginBottom = '12px';
    responsibleDesc.style.color = 'var(--text-muted)';
    responsibleDesc.style.fontSize = '13px';
    responsibleDesc.setText('预先配置负责人名单，创建/编辑项目时可直接从下拉列表中选择。');

    this.renderResponsiblePersonsSettings(containerEl);

    containerEl.createEl('h3', { text: '默认待办设置' });

    const defaultTodoDesc = containerEl.createDiv({ cls: 'avm-default-todo-desc' });
    defaultTodoDesc.style.marginBottom = '12px';
    defaultTodoDesc.style.color = 'var(--text-muted)';
    defaultTodoDesc.style.fontSize = '13px';
    defaultTodoDesc.setText('新建项目时自动添加以下待办事项。');

    this.renderDefaultTodosSettings(containerEl);

    containerEl.createEl('h3', { text: '数据迁移' });

    this.renderMigrationSettings(containerEl);
  }

  private renderMigrationSettings(containerEl: HTMLElement) {
    const migrationDesc = containerEl.createDiv({ cls: 'avm-migration-desc' });
    migrationDesc.style.marginBottom = '12px';
    migrationDesc.style.color = 'var(--text-muted)';
    migrationDesc.style.fontSize = '13px';
    migrationDesc.setText('从旧版 APP Version Manager 或 todolist 插件迁移数据。迁移不会修改原始数据。');

    // 旧数据路径
    new Setting(containerEl)
      .setName('旧 AVM 数据路径')
      .setDesc('旧版 APP Version Manager 的数据目录（支持 vault 相对路径或绝对路径）')
      .addText((text) =>
        text
          .setPlaceholder('app-version-manager')
          .setValue(this.plugin.settings.oldDataPath || 'app-version-manager')
          .onChange(async (value) => {
            this.plugin.settings.oldDataPath = value.trim() || 'app-version-manager';
            await this.plugin.saveSettings();
          }),
      );

    // 迁移状态
    const statusSetting = new Setting(containerEl).setName('迁移状态');
    if (this.plugin.settings.migrationCompleted) {
      statusSetting.setDesc('✅ 迁移已完成');
    } else if (this.plugin.settings.migrationError) {
      statusSetting.setDesc(`❌ 迁移失败: ${this.plugin.settings.migrationError}`);
    } else {
      statusSetting.setDesc('⏳ 尚未迁移');
    }

    // 迁移按钮
    new Setting(containerEl)
      .setName('执行迁移')
      .setDesc('开始数据迁移（会自动备份旧数据到 workflow-hub/_migration_backup_时间戳/）')
      .addButton((btn) =>
        btn
          .setButtonText(this.plugin.settings.migrationCompleted ? '重新迁移' : '开始迁移')
          .setCta()
          .onClick(async () => {
            btn.setDisabled(true);
            btn.setButtonText('迁移中...');
            try {
              const migration = new MigrationService(this.plugin);
              // 使用用户配置的旧数据路径
              migration.setOldDataPath(this.plugin.settings.oldDataPath);
              await migration.run();
              if (this.plugin.settings.migrationCompleted) {
                new Notice('数据迁移完成！');
              } else if (this.plugin.settings.migrationError) {
                new Notice(`迁移失败: ${this.plugin.settings.migrationError}`);
              }
              this.display();
            } catch (e) {
              new Notice(`迁移失败: ${e instanceof Error ? e.message : String(e)}`);
              btn.setDisabled(false);
              btn.setButtonText('开始迁移');
            }
          }),
      );
  }

  private renderProgressStagesSettings(containerEl: HTMLElement) {
    const stages = this.plugin.dataConfigService.config.progressStages;

    stages.forEach((stage, index) => {
      const setting = new Setting(containerEl).setName(`阶段 ${index + 1}`).setClass('avm-progress-stage-setting');

      setting.addText((text) =>
        text
          .setValue(stage.name)
          .setPlaceholder('阶段名称')
          .onChange(async (value) => {
            stages[index].name = value;
            this.plugin.dataConfigService.config.progressStages = stages;
            await this.plugin.dataConfigService.save();
          }),
      );

      setting.addColorPicker((picker) =>
        picker.setValue(stage.color).onChange(async (value) => {
          stages[index].color = value;
          this.plugin.dataConfigService.config.progressStages = stages;
          await this.plugin.dataConfigService.save();
        }),
      );

      if (stages.length > 1) {
        setting.addExtraButton((btn) =>
          btn
            .setIcon('arrow-up')
            .setTooltip('上移')
            .onClick(async () => {
              if (index > 0) {
                [stages[index - 1], stages[index]] = [stages[index], stages[index - 1]];
                this.plugin.dataConfigService.config.progressStages = stages;
                await this.plugin.dataConfigService.save();
                this.display();
              }
            }),
        );

        setting.addExtraButton((btn) =>
          btn
            .setIcon('arrow-down')
            .setTooltip('下移')
            .onClick(async () => {
              if (index < stages.length - 1) {
                [stages[index], stages[index + 1]] = [stages[index + 1], stages[index]];
                this.plugin.dataConfigService.config.progressStages = stages;
                await this.plugin.dataConfigService.save();
                this.display();
              }
            }),
        );
      }

      setting.addExtraButton((btn) =>
        btn
          .setIcon('trash')
          .setTooltip('删除')
          .onClick(async () => {
            if (stages.length > 1) {
              stages.splice(index, 1);
              this.plugin.dataConfigService.config.progressStages = stages;
              await this.plugin.dataConfigService.save();
              this.display();
            } else {
              new Notice('至少需要保留一个阶段');
            }
          }),
      );
    });
  }

  private renderDefaultTodosSettings(containerEl: HTMLElement) {
    const todos = this.plugin.dataConfigService.config.defaultTodos;

    todos.forEach((todo, index) => {
      const setting = new Setting(containerEl).setClass('avm-default-todo-setting');

      setting.addText((text) =>
        text
          .setValue(todo.content)
          .setPlaceholder('待办内容')
          .onChange(async (value) => {
            todos[index].content = value;
            await this.plugin.dataConfigService.save();
          }),
      );

      setting.addExtraButton((btn) =>
        btn
          .setIcon('trash')
          .setTooltip('删除')
          .onClick(async () => {
            todos.splice(index, 1);
            this.plugin.dataConfigService.config.defaultTodos = todos;
            await this.plugin.dataConfigService.save();
            this.display();
          }),
      );
    });

    new Setting(containerEl).setName('添加默认待办').addButton((btn) =>
      btn.setButtonText('添加').onClick(async () => {
        todos.push({ content: '', link: '', dueDate: '' });
        this.plugin.dataConfigService.config.defaultTodos = todos;
        await this.plugin.dataConfigService.save();
        this.display();
      }),
    );
  }

  private renderResponsiblePersonsSettings(containerEl: HTMLElement) {
    const persons = this.plugin.dataConfigService.config.responsiblePersons;

    persons.forEach((person, index) => {
      const setting = new Setting(containerEl).setClass('avm-responsible-person-setting');

      setting.addText((text) =>
        text
          .setValue(person)
          .setPlaceholder('负责人姓名')
          .onChange(async (value) => {
            persons[index] = value;
            this.plugin.dataConfigService.config.responsiblePersons = persons;
            await this.plugin.dataConfigService.save();
          }),
      );

      setting.addExtraButton((btn) =>
        btn
          .setIcon('trash')
          .setTooltip('删除')
          .onClick(async () => {
            persons.splice(index, 1);
            this.plugin.dataConfigService.config.responsiblePersons = persons;
            await this.plugin.dataConfigService.save();
            this.display();
          }),
      );
    });

    new Setting(containerEl).setName('添加负责人').addButton((btn) =>
      btn.setButtonText('添加').onClick(async () => {
        persons.push('');
        this.plugin.dataConfigService.config.responsiblePersons = persons;
        await this.plugin.dataConfigService.save();
        this.display();
      }),
    );
  }

  private generateRandomColor(): string {
    const colors = [
      '#6366f1',
      '#8b5cf6',
      '#ec4899',
      '#f59e0b',
      '#3b82f6',
      '#10b981',
      '#ef4444',
      '#f97316',
      '#14b8a6',
      '#64748b',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
