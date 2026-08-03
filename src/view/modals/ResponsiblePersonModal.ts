import { Modal, App as ObsidianApp, Setting, TextComponent, Notice } from 'obsidian';
import AppVersionManagerPlugin from '../../main';

/** 负责人管理弹窗 */
export class ResponsiblePersonModal extends Modal {
  private plugin: AppVersionManagerPlugin;
  private onChange?: () => void;

  constructor(app: ObsidianApp, plugin: AppVersionManagerPlugin, onChange?: () => void) {
    super(app);
    this.plugin = plugin;
    this.onChange = onChange;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');
    contentEl.createEl('h2', { text: '负责人管理' });
    contentEl.createEl('p', { text: '添加或删除负责人，用于待办数据隔离。', cls: 'avm-modal-desc' });
    this.renderList();
  }

  private getPersons(): string[] {
    return this.plugin.dataConfigService.config.responsiblePersons ?? [];
  }

  /**
   * 保存负责人列表。任何一步失败都会：回滚内存配置、弹出错误提示、刷新列表，
   * 避免"点击无反应"式的静默失败（保存/刷新链路抛错时列表不更新）。
   */
  private async savePersons(persons: string[]) {
    const prev = [...this.plugin.dataConfigService.config.responsiblePersons];
    try {
      this.plugin.dataConfigService.config.responsiblePersons = persons;
      await this.plugin.dataConfigService.save();
    } catch (e) {
      this.plugin.dataConfigService.config.responsiblePersons = prev;
      new Notice(`负责人保存失败：${e instanceof Error ? e.message : String(e)}`);
      this.renderList();
      return;
    }
    this.renderList();
    // 视图刷新失败不影响弹窗自身状态，仅记录日志
    try {
      this.onChange?.();
    } catch (e) {
      console.error('[WorkflowHub] 负责人变更后刷新视图失败:', e);
    }
  }

  private renderList() {
    let container = this.contentEl.querySelector('.avm-person-list') as HTMLElement | null;
    if (container) {
      container.empty();
    } else {
      container = this.contentEl.createDiv({ cls: 'avm-person-list' });
    }

    const persons = this.getPersons();

    if (persons.length === 0) {
      container.createEl('p', { text: '暂无负责人，请添加。', cls: 'avm-empty-hint' });
    }

    persons.forEach((person, index) => {
      const setting = new Setting(container!).setName(`负责人 ${index + 1}`);

      let editName = person;
      setting.addText((text) => {
        text.setValue(person).onChange((v) => (editName = v));
      });

      // 上移
      setting.addExtraButton((btn) =>
        btn
          .setIcon('arrow-up')
          .setTooltip('上移')
          .onClick(async () => {
            if (index > 0) {
              const list = [...persons];
              [list[index - 1], list[index]] = [list[index], list[index - 1]];
              await this.savePersons(list);
            }
          }),
      );

      // 下移
      setting.addExtraButton((btn) =>
        btn
          .setIcon('arrow-down')
          .setTooltip('下移')
          .onClick(async () => {
            if (index < persons.length - 1) {
              const list = [...persons];
              [list[index], list[index + 1]] = [list[index + 1], list[index]];
              await this.savePersons(list);
            }
          }),
      );

      // 保存（重命名）
      setting.addExtraButton((btn) =>
        btn
          .setIcon('check')
          .setTooltip('保存')
          .onClick(async () => {
            const trimmed = editName.trim();
            if (!trimmed) {
              new Notice('负责人名称不能为空');
              return;
            }
            if (trimmed !== person && persons.includes(trimmed)) {
              new Notice('该负责人已存在');
              return;
            }
            const list = [...persons];
            list[index] = trimmed;
            await this.savePersons(list);
          }),
      );

      // 删除
      setting.addExtraButton((btn) =>
        btn
          .setIcon('trash')
          .setTooltip('删除')
          .onClick(async () => {
            const list = persons.filter((_, i) => i !== index);
            await this.savePersons(list);
          }),
      );
    });

    // 新增负责人行
    const addSetting = new Setting(container).setName('添加新负责人');
    let newName = '';
    addSetting.addText((text) => {
      text.setPlaceholder('负责人名称').onChange((v) => (newName = v));
    });
    addSetting.addButton((btn) =>
      btn
        .setButtonText('添加')
        .setCta()
        .onClick(async () => {
          const name = newName.trim();
          if (!name) {
            new Notice('请输入负责人名称');
            return;
          }
          if (persons.includes(name)) {
            new Notice('该负责人已存在');
            return;
          }
          await this.savePersons([...persons, name]);
        }),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
