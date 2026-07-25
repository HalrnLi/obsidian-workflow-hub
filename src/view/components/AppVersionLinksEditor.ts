import { Setting, ButtonComponent, Notice, DropdownComponent } from 'obsidian';
import { App, Version, ProjectLink } from '../../types';

/**
 * APP/版本关联编辑器 — 用于项目编辑/创建弹窗
 * 使用 Obsidian Setting 组件保持 UI 一致
 */
export class AppVersionLinksEditor {
  private container: HTMLElement;
  private apps: App[];
  private versions: Version[];
  private links: ProjectLink[];
  private onChange?: () => void;

  constructor(container: HTMLElement, apps: App[], versions: Version[], links: ProjectLink[], onChange?: () => void) {
    this.container = container;
    this.apps = apps;
    this.versions = versions;
    this.links = links;
    this.onChange = onChange;
    this.render();
  }

  private render(): void {
    this.container.empty();

    // 标题
    const header = this.container.createDiv({ cls: 'avm-links-editor-header' });
    header.createSpan({ cls: 'avm-links-editor-title', text: '关联 APP / 版本' });
    header.createSpan({ cls: 'avm-links-editor-subtitle', text: '（可选，一个项目可关联多个 APP）' });

    // 已关联列表
    const listEl = this.container.createDiv({ cls: 'avm-links-editor-list' });
    this.renderList(listEl);

    // 添加区域
    this.renderAddSection(this.container);
  }

  private renderList(listEl: HTMLElement): void {
    listEl.empty();
    if (this.links.length === 0) {
      listEl.createDiv({ cls: 'avm-links-editor-empty', text: '未关联任何 APP / 版本' });
      return;
    }

    this.links.forEach((link, index) => {
      const app = this.apps.find((a) => a.id === link.appId);
      const version = this.versions.find((v) => v.id === link.versionId);
      const appLabel = app ? app.name : '(未知 APP)';
      const verLabel = version ? version.versionNumber : '(未知版本)';

      new Setting(listEl)
        .setClass('avm-links-editor-item')
        .addText((text) => {
          text.setValue(`${appLabel} / ${verLabel}`).setDisabled(true);
          text.inputEl.addClass('avm-links-editor-item-text');
        })
        .addButton((btn) => {
          btn
            .setIcon('trash')
            .setTooltip('移除')
            .onClick(() => {
              this.links.splice(index, 1);
              this.render();
              this.onChange?.();
            });
        });
    });
  }

  private renderAddSection(container: HTMLElement): void {
    const addEl = container.createDiv({ cls: 'avm-links-editor-add' });

    let selectedAppId = '';
    let selectedVersionId = '';

    // 版本下拉引用（需要在 APP change 回调中操作）
    let versionDropdown: DropdownComponent;

    // APP 下拉
    new Setting(addEl)
      .setClass('avm-links-editor-add-app')
      .addDropdown((dropdown) => {
        dropdown.addOption('', '选择 APP...');
        this.apps.forEach((app) => dropdown.addOption(app.id, app.name));
        dropdown.onChange((value) => {
          selectedAppId = value;
          selectedVersionId = '';
          // 重置版本下拉
          if (versionDropdown) {
            versionDropdown.selectEl.empty();
            versionDropdown.addOption('', '选择版本...');
            if (value) {
              const appVersions = this.versions.filter((v) => v.appId === value && !v.isArchived);
              appVersions.forEach((v) => versionDropdown.addOption(v.id, v.versionNumber));
              versionDropdown.setDisabled(false);
            } else {
              versionDropdown.setDisabled(true);
            }
            versionDropdown.setValue('');
          }
        });
      });

    // 版本下拉
    new Setting(addEl)
      .setClass('avm-links-editor-add-version')
      .addDropdown((dropdown) => {
        dropdown.addOption('', '选择版本...');
        dropdown.setDisabled(true);
        dropdown.onChange((value) => {
          selectedVersionId = value;
        });
        versionDropdown = dropdown;
      });

    // 添加按钮
    new Setting(addEl)
      .setClass('avm-links-editor-add-btn')
      .addButton((btn) => {
        btn
          .setIcon('plus')
          .setButtonText('添加')
          .onClick(() => {
            if (!selectedAppId || !selectedVersionId) {
              new Notice('请选择 APP 和版本');
              return;
            }
            if (this.links.some((l) => l.appId === selectedAppId)) {
              new Notice('该项目已关联此 APP，请先移除后再添加');
              return;
            }
            this.links.push({ appId: selectedAppId, versionId: selectedVersionId });
            this.render();
            this.onChange?.();
          });
      });
  }

  getLinks(): ProjectLink[] {
    return this.links;
  }
}
