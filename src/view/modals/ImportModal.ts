import { Modal, App as ObsidianApp, Notice } from 'obsidian';
import { ImportExportService } from '../../services/ImportExportService';
import { BackupService } from '../../services/BackupService';
import { createActionButtons } from '../ModalUtils';

export class ImportModal extends Modal {
  importExportService: ImportExportService;
  backupService: BackupService | null;
  appId: string | null;
  onComplete: () => void;

  constructor(
    app: ObsidianApp,
    importService: ImportExportService,
    backupService: BackupService | null,
    appId: string | null,
    onComplete: () => void,
  ) {
    super(app);
    this.importExportService = importService;
    this.backupService = backupService;
    this.appId = appId;
    this.onComplete = onComplete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('avm-modal');

    contentEl.createEl('h2', { text: '导入数据' });

    const fileInput = contentEl.createEl('input', {
      attr: { type: 'file', accept: '.csv,.xlsx,.xls,.json' },
    });

    const statusEl = contentEl.createDiv({ cls: 'avm-import-status' });
    const hintEl = contentEl.createEl('p', { text: '支持 CSV、Excel (.xlsx/.xls) 和备份文件 (.json)' });
    hintEl.style.color = 'var(--text-muted)';
    hintEl.style.fontSize = '12px';

    createActionButtons(contentEl, {
      confirmText: '导入',
      cancelText: '取消',
      onConfirm: async () => {
        const file = fileInput.files?.[0];
        if (!file) {
          new Notice('请选择文件');
          return;
        }

        statusEl.setText('处理中...');

        try {
          if (file.name.endsWith('.json')) {
            if (!this.backupService) {
              throw new Error('备份恢复功能不可用');
            }
            if (!confirm('这是备份文件，确定要恢复吗？当前数据将被覆盖。')) {
              statusEl.setText('已取消');
              return;
            }
            const content = await file.text();
            const success = await this.backupService.restoreFromContent(content);
            if (success) {
              new Notice('恢复成功');
              statusEl.setText('恢复成功');
              setTimeout(() => {
                this.onComplete();
                this.close();
              }, 800);
            } else {
              throw new Error('恢复失败');
            }
          } else if (file.name.endsWith('.csv')) {
            const content = await file.text();
            const result = await this.importExportService.importFromCSV(content);
            new Notice(`导入完成！成功: ${result.success} 条${result.errors.length > 0 ? `\n错误: ${result.errors.join('\n')}` : ''}`);
            statusEl.setText('导入成功');
            setTimeout(() => {
              this.onComplete();
              this.close();
            }, 800);
          } else {
            const buffer = await file.arrayBuffer();
            const result = await this.importExportService.importFromExcel(buffer);
            new Notice(`导入完成！成功: ${result.success} 条${result.errors.length > 0 ? `\n错误: ${result.errors.join('\n')}` : ''}`);
            statusEl.setText('导入成功');
            setTimeout(() => {
              this.onComplete();
              this.close();
            }, 800);
          }
        } catch (error) {
          statusEl.setText(`导入失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      onCancel: () => this.close(),
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
