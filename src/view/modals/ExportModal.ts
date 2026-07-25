import { Modal, App as ObsidianApp, Setting } from 'obsidian';
import { App, Project, Version } from '../../types';
import { ImportExportService } from '../../services/ImportExportService';
import { createActionButtons } from '../ModalUtils';

export class ExportModal extends Modal {
  importExportService: ImportExportService;
  projects: Project[];
  versions: Version[];
  apps: App[];
  format: 'csv' | 'xlsx' = 'csv';

  constructor(app: ObsidianApp, service: ImportExportService, projects: Project[], versions: Version[], apps: App[]) {
    super(app);
    this.importExportService = service;
    this.projects = projects;
    this.versions = versions;
    this.apps = apps;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');

    contentEl.createEl('h2', { text: '导出数据' });

    new Setting(contentEl).setName('导出格式').addDropdown((dropdown) => {
      dropdown.addOption('csv', 'CSV');
      dropdown.addOption('xlsx', 'Excel (XLSX)');
      dropdown.setValue(this.format);
      dropdown.onChange((value) => {
        this.format = value === 'xlsx' ? 'xlsx' : 'csv';
      });
    });

    const statusEl = contentEl.createDiv({ cls: 'avm-export-status' });

    createActionButtons(contentEl, {
      confirmText: '导出',
      cancelText: '取消',
      onConfirm: async () => {
        statusEl.setText('处理中...');
        try {
          if (this.format === 'xlsx') {
            const buffer = await this.importExportService.exportToExcel(this.projects, this.versions, this.apps);
            this.downloadFile(
              buffer,
              'projects.xlsx',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            );
          } else {
            const csv = await this.importExportService.exportToCSV(this.projects, this.versions, this.apps);
            this.downloadFile(csv, 'projects.csv', 'text/csv');
          }
          statusEl.setText('导出成功');
          setTimeout(() => this.close(), 800);
        } catch (error) {
          statusEl.setText(`导出失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      onCancel: () => this.close(),
    });
  }

  private downloadFile(content: string | ArrayBuffer, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  onClose() {
    this.contentEl.empty();
  }
}
