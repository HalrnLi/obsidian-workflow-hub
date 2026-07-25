export const COMMON = `
.app-version-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  padding: 0;
  font-size: 14px;
  position: relative;
}

.avm-header {
  padding: 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
}

.avm-top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  gap: 12px;
}

.avm-app-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.avm-app-actions { display: flex; gap: 4px; }

.avm-view-switcher { display: flex; gap: 4px; }

.avm-view-btn-active {
  background: var(--interactive-accent) !important;
  color: var(--text-on-accent) !important;
}

.avm-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.avm-filter-container {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.avm-filter-item { display: flex; align-items: center; gap: 4px; }

.avm-filter-item select,
.avm-filter-item input {
  padding: 4px 8px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  background: var(--background-primary);
  color: var(--text-normal);
  font-size: 12px;
}

.avm-filter-item select:focus,
.avm-filter-item input:focus {
  outline: none;
  border-color: var(--interactive-accent);
}

.avm-filter-item input { min-width: 120px; }

.avm-search-input {
  flex: 1;
  min-width: 150px;
  padding: 6px 12px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  background: var(--background-primary);
  color: var(--text-normal);
  font-size: 13px;
}

.avm-search-input:focus {
  outline: none;
  border-color: var(--interactive-accent);
}

.avm-select {
  padding: 6px 12px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  background: var(--background-primary);
  color: var(--text-normal);
  font-size: 13px;
  cursor: pointer;
}

.avm-select:focus { outline: none; border-color: var(--interactive-accent); }

.avm-saved-filter { min-width: 120px; }
.avm-filter-actions { display: flex; gap: 4px; }
.avm-action-buttons { display: flex; gap: 4px; margin-left: auto; }

.avm-main { flex: 1; overflow: hidden; width: 100%; }

.avm-dual-pane { display: flex; height: 100%; width: 100%; }

.avm-left-pane {
  width: 280px;
  border-right: 1px solid var(--background-modifier-border);
  display: flex;
  flex-direction: column;
  background: var(--background-secondary);
}

.avm-right-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.avm-pane-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--background-modifier-border);
}

.avm-pane-header h3 { margin: 0; font-size: 14px; font-weight: 600; }

.avm-version-list { flex: 1; overflow-y: auto; padding: 8px; }

.avm-version-item {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background-color 0.15s;
}

.avm-version-item:hover { background: var(--background-modifier-hover); }

.avm-version-item.avm-selected {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}

.avm-version-item.avm-archived { opacity: 0.6; }
.avm-version-number { font-weight: 600; font-size: 13px; }
.avm-version-meta { font-size: 12px; opacity: 0.7; margin-top: 4px; }

.avm-archived-header {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  margin-top: 12px;
  border-top: 1px solid var(--background-modifier-border);
}

.avm-project-list { flex: 1; overflow-y: auto; padding: 12px; }

.avm-project-item {
  padding: 12px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  margin-bottom: 8px;
  background: var(--background-primary);
}

.avm-project-item.avm-overdue {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.05);
}

.avm-project-item.avm-highlighted-row {
  border-color: #ef4444;
  border-width: 2px;
  background: rgba(239, 68, 68, 0.08);
}

.avm-project-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.avm-project-name { font-weight: 600; font-size: 14px; }

.avm-progress-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  color: white;
  font-weight: 500;
}

.avm-progress-badge-small {
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 10px;
  color: white;
  font-weight: 500;
  display: inline-block;
}

.avm-clickable { cursor: pointer; transition: transform 0.1s, opacity 0.1s; }
.avm-clickable:hover { opacity: 0.8; transform: scale(1.05); }

.avm-progress-confirm-modal .avm-confirm-info { padding: 16px 0; }

.avm-progress-confirm-modal .avm-confirm-project {
  font-size: 14px;
  margin-bottom: 20px;
  padding: 12px;
  background: var(--background-secondary);
  border-radius: 8px;
}

.avm-progress-confirm-modal .avm-confirm-label {
  color: var(--text-muted);
  font-size: 12px;
  margin-bottom: 4px;
}

.avm-progress-confirm-modal .avm-confirm-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 16px 0;
}

.avm-progress-confirm-modal .avm-progress-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.avm-progress-confirm-modal .avm-progress-arrow {
  font-size: 24px;
  color: var(--text-muted);
}

.avm-project-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
.avm-meta-item { display: flex; align-items: center; gap: 4px; }
.avm-overdue-text { color: #ef4444; font-weight: 500; }
.avm-project-links { display: flex; gap: 12px; }

.avm-link {
  color: var(--interactive-accent);
  text-decoration: none;
  font-size: 12px;
  cursor: pointer;
}
.avm-link:hover { text-decoration: underline; }

.avm-link-small {
  color: var(--interactive-accent);
  text-decoration: none;
  font-size: 11px;
  cursor: pointer;
  margin-right: 8px;
}
.avm-link-small:hover { text-decoration: underline; }

.avm-project-requirements {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--background-modifier-border);
}

/* Pre-release banner */
.avm-pre-release-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -12px -12px 10px -12px;
  padding: 6px 12px;
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border-bottom: 1px solid #f59e0b;
  border-radius: 8px 8px 0 0;
  font-size: 12px;
  font-weight: 500;
  color: #92400e;
}

.theme-dark .avm-pre-release-banner {
  background: linear-gradient(135deg, #78350f, #92400e);
  border-bottom-color: #d97706;
  color: #fde68a;
}

.avm-pre-release-icon { font-size: 14px; flex-shrink: 0; }
.avm-pre-release-text { line-height: 1.3; }

.avm-pre-release-item {
  border-color: #f59e0b !important;
  box-shadow: 0 0 0 1px #f59e0b;
}

/* Pre-release banner small (Kanban) */
.avm-pre-release-banner-small {
  margin: -8px -8px 6px -8px;
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 6px 6px 0 0;
}

/* Table pre-release row */
.avm-table tr.avm-pre-release-row {
  background: rgba(245, 158, 11, 0.06);
  border-left: 3px solid #f59e0b;
}
.theme-dark .avm-table tr.avm-pre-release-row {
  background: rgba(245, 158, 11, 0.12);
}

/* Table round badge */
.avm-round-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  color: white;
  font-weight: 600;
}
.avm-round-badge-prerelease {
  box-shadow: 0 0 0 2px #f59e0b;
}

/* Gantt pre-release */
.avm-gantt-prerelease-icon {
  color: #f59e0b;
  font-size: 13px;
}
.avm-gantt-round-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  color: white;
  font-weight: 600;
  margin: 2px 4px;
  flex-shrink: 0;
  align-self: center;
}
.avm-gantt-round-badge-prerelease {
  box-shadow: 0 0 0 2px #f59e0b;
}

/* Current stage badge */
.avm-current-stage-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--background-secondary);
  border-radius: 10px;
}

.avm-stage-label {
  font-size: 11px;
  color: var(--text-muted);
}

.avm-stage-value {
  font-size: 11px;
}

.avm-empty-state { text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px; }

/* Tab Bar */
.avm-tab-bar { display: flex; gap: 4px; margin-bottom: 12px; }

.avm-tab {
  padding: 6px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid transparent;
  transition: all 0.15s;
}
.avm-tab:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
.avm-tab.avm-tab-active {
  color: var(--interactive-accent);
  background: var(--background-secondary);
  border-color: var(--background-modifier-border);
}

/* Icon button */
.avm-btn-icon {
  padding: 4px 6px !important;
  border: none !important;
  background: transparent !important;
  cursor: pointer;
  color: var(--text-muted);
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.avm-btn-icon:hover {
  background: var(--background-modifier-hover) !important;
  color: var(--text-normal);
}

/* Modal */
.avm-modal { padding: 20px; }
.avm-modal h2 { margin-top: 0; margin-bottom: 20px; font-size: 18px; }
.avm-modal .setting-item-control input[type="text"],
.avm-modal .setting-item-control textarea,
.avm-modal .setting-item-control select { width: 280px; }
.avm-modal .setting-item-control textarea { min-height: 60px; resize: vertical; }
.avm-modal-buttons { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }

/* Loading & Error states */
.avm-loading { display: flex; align-items: center; justify-content: center; height: 100%; font-size: 16px; color: var(--text-muted); }
.avm-error { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; color: var(--text-muted); }
.avm-error button { padding: 8px 16px; border-radius: 4px; background: var(--interactive-accent); color: var(--text-on-accent); border: none; cursor: pointer; }

/* Import/Export status */
.avm-export-status,
.avm-import-status { margin-top: 12px; padding: 8px; text-align: center; color: var(--text-muted); font-size: 13px; }

/* Dark theme */
.theme-dark .avm-kanban-card:hover { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); }
.theme-dark .avm-project-item.avm-overdue,
.theme-dark .avm-table tr.avm-overdue-row { background: rgba(239, 68, 68, 0.1); }
.theme-dark .avm-gantt-day-cell.avm-gantt-today { background: rgba(99, 102, 241, 0.3); }

/* Scrollbar */
.app-version-manager ::-webkit-scrollbar { width: 8px; height: 8px; }
.app-version-manager ::-webkit-scrollbar-track { background: transparent; }
.app-version-manager ::-webkit-scrollbar-thumb { background: var(--background-modifier-border); border-radius: 4px; }
.app-version-manager ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
.theme-dark .app-version-manager ::-webkit-scrollbar-thumb { background: var(--background-modifier-border); }
.theme-dark .app-version-manager ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* ============ Todo Tab ============ */
.avm-main[data-tab="todos"] {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Category tabs */
.avm-category-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
  overflow-x: auto;
}
.avm-category-tabs .avm-tab {
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  border: 1px solid transparent;
}
.avm-category-tabs .avm-tab:hover {
  background: var(--background-modifier-hover);
}
.avm-category-tabs .avm-tab-active {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}

/* Todo filter bar */
.avm-main[data-tab="todos"] .avm-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.avm-main[data-tab="todos"] .avm-filter-bar select {
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  font-size: 13px;
}
.avm-main[data-tab="todos"] .avm-filter-bar input {
  flex: 1;
  min-width: 120px;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  font-size: 13px;
}

/* Todo list */
.avm-todo-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}
.avm-todo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--background-modifier-border-hover);
  border-radius: 4px;
}
.avm-todo-item:hover {
  background: var(--background-modifier-hover);
}
.avm-todo-item.avm-todo-done {
  opacity: 0.5;
}
.avm-todo-item.avm-todo-done .avm-todo-content {
  text-decoration: line-through;
  color: var(--text-muted);
}
.avm-todo-item.avm-todo-pinned {
  background: var(--background-secondary);
  border-left: 3px solid var(--interactive-accent);
}
.avm-todo-status-icon {
  flex-shrink: 0;
  cursor: pointer;
  font-size: 18px;
  width: 24px;
  text-align: center;
  line-height: 1.2;
}
.avm-priority-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  color: white;
  font-weight: 600;
}
.avm-todo-content {
  flex: 1;
  font-size: 13px;
  word-break: break-word;
}
.avm-todo-project-tag {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--background-modifier-hover);
  padding: 1px 6px;
  border-radius: 4px;
}
.avm-todo-due {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}
.avm-todo-due.avm-overdue-text {
  color: #ef4444;
  font-weight: 600;
}
.avm-todo-due.avm-urgent-text {
  color: #f59e0b;
  font-weight: 600;
}
.avm-todo-reminder {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--interactive-accent);
  font-weight: 500;
}
.avm-todo-actions {
  flex-shrink: 0;
  display: flex;
  gap: 4px;
}
.avm-todo-stats {
  font-size: 12px;
  color: var(--text-muted);
  padding: 4px 12px;
}

/* ============ Project Detail Panel ============ */
.avm-project-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}
.avm-project-detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
}
.avm-project-detail-header h3 {
  margin: 0;
  flex: 1;
}
.avm-project-detail-info {
  padding: 12px;
  border-bottom: 1px solid var(--background-modifier-border);
}
.avm-project-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.avm-meta-item {
  font-size: 12px;
  color: var(--text-muted);
}
.avm-project-links {
  display: flex;
  gap: 8px;
}
.avm-project-detail-section {
  padding: 12px;
  border-bottom: 1px solid var(--background-modifier-border);
}
/* 子 Tab 栏 */
.avm-sub-tab-bar {
  display: flex;
  gap: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  margin-top: 4px;
}
.avm-sub-tab-bar .avm-tab {
  padding: 6px 12px;
  font-size: 12px;
}

/* 项目详情页签 */
.avm-detail-tabs {
  display: flex;
  gap: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
}
.avm-detail-tabs .avm-tab {
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--text-muted);
}
.avm-detail-tabs .avm-tab:hover {
  color: var(--text-normal);
}
.avm-detail-tabs .avm-tab-active {
  color: var(--text-normal);
  border-bottom-color: var(--interactive-accent);
  font-weight: 500;
}

.avm-project-detail-section .avm-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.avm-project-detail-section .avm-section-header h4 {
  margin: 0;
  font-size: 14px;
}
.avm-project-info-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.avm-project-info-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--background-secondary);
}
.avm-project-info-desc {
  flex: 1;
  font-size: 13px;
}
.avm-project-info-actions {
  display: flex;
  gap: 4px;
}
.avm-project-info-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: var(--background-secondary);
  border-radius: 4px;
}

/* ============ Edit Project Modal — scrollable ============ */
.avm-modal {
  max-height: 80vh;
  overflow-y: auto;
}
.avm-modal h3 {
  margin-top: 16px;
  margin-bottom: 8px;
  font-size: 14px;
}
.avm-modal .setting-item {
  border-top: none;
  padding: 4px 0;
}

/* ============ 项目列表+详情滑出面板 ============ */
.avm-project-with-detail {
  display: flex;
  height: 100%;
  width: 100%;
  overflow: hidden;
}
.avm-project-list-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.avm-detail-back-bar {
  padding: 8px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
}
.avm-detail-view-container {
  flex: 1;
  overflow: hidden;
  width: 100%;
}
.avm-detail-view-container > .avm-dual-pane {
  height: 100%;
}
.avm-project-detail-pane {
  width: 300px;
  min-width: 260px;
  border-left: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  overflow-y: auto;
  flex-shrink: 0;
}
.avm-project-item-active {
  border-color: var(--interactive-accent) !important;
  border-width: 2px !important;
  background: rgba(99, 102, 241, 0.05);
}

/* ============ 项目详情（只读） ============ */
.avm-project-readonly {
  padding: 12px;
  font-size: 13px;
  user-select: text;
  cursor: text;
}
.avm-readonly-section {
  margin: 16px 0 8px 0;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--background-modifier-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-accent);
}
.avm-readonly-section:first-child {
  margin-top: 0;
}
.avm-readonly-row {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  line-height: 1.5;
}
.avm-readonly-label {
  flex-shrink: 0;
  min-width: 90px;
  color: var(--text-muted);
  font-weight: 500;
}
.avm-readonly-value {
  flex: 1;
  color: var(--text-normal);
  word-break: break-word;
}

/* ============ 待办双栏布局 ============ */
.avm-todo-wrapper {
  display: flex;
  height: 100%;
  overflow: hidden;
}
.avm-todo-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.avm-todo-main .avm-category-tabs,
.avm-todo-main .avm-filter-bar {
  flex-shrink: 0;
}
.avm-todo-main .avm-todo-list {
  flex: 1;
  overflow-y: auto;
}
.avm-temp-toggle-btn {
  position: absolute;
  right: 8px;
  top: 8px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
  border: 1px solid var(--background-modifier-border);
  border-radius: 3px;
  background: var(--background-primary);
  z-index: 1;
}
.avm-temp-toggle-btn:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}

/* 右侧临时待办面板 */
.avm-temp-panel {
  width: 220px;
  min-width: 180px;
  border-left: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.avm-temp-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
}
.avm-temp-title {
  flex: 1;
  font-size: 12px;
  font-weight: 500;
}
.avm-temp-count {
  font-size: 11px;
  color: var(--text-muted);
}
.avm-temp-clear-btn {
  font-size: 10px;
  padding: 2px 6px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.avm-temp-clear-btn:hover {
  background: var(--background-modifier-hover);
}
.avm-temp-input-row {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
}
.avm-temp-input {
  flex: 1;
  padding: 3px 6px;
  font-size: 12px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  background: var(--background-primary);
}
.avm-temp-add-btn {
  padding: 3px 8px;
  font-size: 13px;
  background: var(--interactive-accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.avm-temp-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}
.avm-temp-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}
.avm-temp-item.avm-temp-done .avm-todo-content {
  text-decoration: line-through;
  color: var(--text-muted);
}
/* 临时待办提醒图标（参考 todolist .todo-reminder-icon） */
.avm-todo-reminder-icon {
  flex-shrink: 0;
  font-size: 13px;
  cursor: default;
}

/* ============ Toast 通知 ============ */
.avm-toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.avm-toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-left: 3px solid var(--interactive-accent);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  pointer-events: auto;
  max-width: 360px;
  animation: avm-toast-in 0.2s ease;
}
@keyframes avm-toast-in {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}
.avm-toast-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.avm-toast-text {
  flex: 1;
  font-size: 13px;
  color: var(--text-normal);
}
.avm-toast-hint {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* ============ Misc ============ */
.avm-link {
  color: var(--text-accent);
  text-decoration: none;
  cursor: pointer;
  font-size: 12px;
}
.avm-link:hover {
  text-decoration: underline;
}
.avm-empty-state {
  text-align: center;
  color: var(--text-muted);
  padding: 24px;
  font-size: 13px;
}
.avm-btn-icon {
  padding: 2px 6px !important;
  min-width: auto !important;
}
.avm-migration-desc {
  margin-bottom: 12px;
  color: var(--text-muted);
  font-size: 13px;
}

/* ============ Test Plan Modal ============ */
.avm-test-plan-subtitle {
  margin: 4px 0;
  font-weight: 500;
  font-size: 14px;
}
.avm-test-plan-hint {
  margin: 0 0 16px 0;
  color: var(--text-muted);
  font-size: 12px;
}
`;
