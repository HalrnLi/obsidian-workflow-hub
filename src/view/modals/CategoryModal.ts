import { Modal, App as ObsidianApp, Setting, TextComponent, Notice } from 'obsidian';
import AppVersionManagerPlugin from '../../main';
import { Category } from '../../types';
import { ConfirmModal } from '../ConfirmModal';

/** 分类管理弹窗（CRUD） */
export class CategoryModal extends Modal {
  private plugin: AppVersionManagerPlugin;
  private onChange?: () => void;
  private categories: Category[] = [];
  /** 编辑中的分类 ID -> 临时数据 */
  private editing = new Map<string, { name: string; color: string }>();
  /** 保存每个分类的 TextComponent 引用 */
  private nameInputs = new Map<string, TextComponent>();
  /** 保存每个分类的保存按钮元素 */
  private saveButtons = new Map<string, HTMLElement>();

  constructor(app: ObsidianApp, plugin: AppVersionManagerPlugin, onChange?: () => void) {
    super(app);
    this.plugin = plugin;
    this.onChange = onChange;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');
    contentEl.createEl('h2', { text: '分类管理' });
    this.editing.clear();
    this.nameInputs.clear();
    this.saveButtons.clear();
    await this.reload();
    this.renderList();
  }

  private async reload() {
    this.categories = await this.plugin.categoryService.getAll();
  }

  /** 获取分类的显示值（优先取编辑中的临时值） */
  private getEditValue(cat: Category): { name: string; color: string } {
    const edit = this.editing.get(cat.id);
    return edit ?? { name: cat.name, color: cat.color };
  }

  /** 检查分类是否有未保存的修改 */
  private hasChanges(cat: Category): boolean {
    const edit = this.editing.get(cat.id);
    if (!edit) return false;
    return edit.name !== cat.name || edit.color !== cat.color;
  }

  private renderList() {
    let container = this.contentEl.querySelector('.avm-category-list') as HTMLElement | null;
    if (container) {
      container.empty();
    } else {
      container = this.contentEl.createDiv({ cls: 'avm-category-list' });
    }

    this.categories.forEach((cat, index) => {
      const edit = this.getEditValue(cat);
      const setting = new Setting(container!).setName(`分类 ${index + 1}`);

      // 名称输入框（不实时保存，只更新临时数据）
      setting.addText((text) => {
        text.setValue(edit.name);
        this.nameInputs.set(cat.id, text);
        text.onChange((v) => {
          this.editing.set(cat.id, { name: v, color: edit.color });
          this.updateSaveButton(cat.id);
        });
      });

      // 颜色选择器
      setting.addColorPicker((picker) =>
        picker.setValue(edit.color).onChange((v) => {
          const current = this.editing.get(cat.id);
          this.editing.set(cat.id, { name: current?.name ?? cat.name, color: v });
          this.updateSaveButton(cat.id);
        }),
      );

      // 上移
      setting.addExtraButton((btn) =>
        btn.setIcon('arrow-up').setTooltip('上移').onClick(async () => {
          if (index > 0) {
            const prev = this.categories[index - 1];
            await this.plugin.categoryService.update(cat.id, { sortOrder: prev.sortOrder }, cat.version);
            await this.plugin.categoryService.update(prev.id, { sortOrder: cat.sortOrder }, prev.version);
            await this.reload();
            this.onChange?.();
            this.renderList();
          }
        }),
      );

      // 下移
      setting.addExtraButton((btn) =>
        btn.setIcon('arrow-down').setTooltip('下移').onClick(async () => {
          if (index < this.categories.length - 1) {
            const next = this.categories[index + 1];
            await this.plugin.categoryService.update(cat.id, { sortOrder: next.sortOrder }, cat.version);
            await this.plugin.categoryService.update(next.id, { sortOrder: cat.sortOrder }, next.version);
            await this.reload();
            this.onChange?.();
            this.renderList();
          }
        }),
      );

      // 保存按钮
      setting.addExtraButton((btn) =>
        btn.setIcon('check').setTooltip('保存').onClick(async () => {
          const editData = this.editing.get(cat.id);
          if (!editData) return;
          const trimmedName = editData.name.trim();
          if (!trimmedName) {
            new Notice('分类名称不能为空');
            return;
          }
          try {
            await this.plugin.categoryService.update(cat.id, { name: trimmedName, color: editData.color }, cat.version);
            this.editing.delete(cat.id);
            await this.reload();
            this.onChange?.();
            this.renderList();
          } catch (e) {
            new Notice(e instanceof Error ? e.message : String(e));
          }
        }),
      );
      // 保存按钮是最后一个 extraButton，通过 settingEl 查找
      const saveBtnEl = setting.settingEl.querySelector('.setting-item-extra-button:last-child') as HTMLElement | null;
      if (saveBtnEl) {
        this.saveButtons.set(cat.id, saveBtnEl);
        saveBtnEl.style.display = this.hasChanges(cat) ? '' : 'none';
      }

      // 删除
      setting.addExtraButton((btn) =>
        btn.setIcon('trash').setTooltip('删除').onClick(() => {
          new ConfirmModal(
            this.app,
            '删除分类',
            `确定删除分类 "${cat.name}" 吗？\n该分类下的待办不会删除，会变为"未分类"。`,
            async () => {
              try {
                await this.plugin.categoryService.delete(cat.id);
                this.editing.delete(cat.id);
                await this.reload();
                this.onChange?.();
                this.renderList();
              } catch (e) {
                new Notice(e instanceof Error ? e.message : String(e));
              }
            },
            undefined,
            true,
          ).open();
        }),
      );
    });

    // 新增分类行
    const addSetting = new Setting(container).setName('添加新分类');
    let newName = '';
    let newColor = '#64748b';
    addSetting.addText((text) => {
      text.setPlaceholder('分类名称').onChange((v) => (newName = v));
    });
    addSetting.addColorPicker((picker) => {
      picker.setValue(newColor).onChange((v) => (newColor = v));
    });
    addSetting.addButton((btn) =>
      btn.setButtonText('添加').setCta().onClick(async () => {
        const name = newName.trim();
        if (!name) {
          new Notice('请输入分类名称');
          return;
        }
        try {
          await this.plugin.categoryService.create({ name, color: newColor });
          newName = '';
          await this.reload();
          this.onChange?.();
          this.renderList();
        } catch (e) {
          new Notice(e instanceof Error ? e.message : String(e));
        }
      }),
    );
  }

  /** 更新指定分类的保存按钮可见性（不重建列表） */
  private updateSaveButton(categoryId: string) {
    const saveBtn = this.saveButtons.get(categoryId);
    if (!saveBtn) return;
    const cat = this.categories.find((c) => c.id === categoryId);
    if (!cat) return;
    saveBtn.style.display = this.hasChanges(cat) ? '' : 'none';
  }

  onClose() {
    this.contentEl.empty();
  }
}
