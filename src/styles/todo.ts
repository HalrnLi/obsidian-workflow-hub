export const TODO = `
/* Todo side panel */
.avm-todo-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.3);
  z-index: 10;
  display: none;
}
.avm-todo-overlay.open { display: block; }

.avm-todo-panel {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 360px;
  background: var(--background-primary);
  border-left: 1px solid var(--background-modifier-border);
  z-index: 11;
  display: flex; flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.2s ease;
}
.avm-todo-panel.open { transform: translateX(0); }

.avm-todo-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--background-modifier-border); flex-shrink: 0; }
.avm-todo-panel-title { font-weight: 600; font-size: 15px; }
.avm-todo-panel-close { cursor: pointer; border: none; background: none; font-size: 18px; color: var(--text-muted); padding: 4px 8px; }

.avm-todo-list { flex: 1; overflow-y: auto; padding: 8px 0; }
.avm-todo-empty { text-align: center; color: var(--text-muted); padding: 40px 16px; font-size: 14px; }

.avm-todo-item { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--background-modifier-border-hover); }
.avm-todo-item.overdue { border-left: 3px solid #ef4444; }
.avm-todo-item.completed .avm-todo-content { text-decoration: line-through; color: var(--text-muted); }

.avm-todo-checkbox { flex-shrink: 0; width: 16px; height: 16px; cursor: pointer; }
.avm-todo-content { flex: 1; font-size: 13px; cursor: pointer; }
.avm-todo-due { font-size: 11px; color: var(--text-muted); white-space: nowrap; flex-shrink: 0; cursor: pointer; }
.avm-todo-due.overdue { color: #ef4444; font-weight: 600; }
.avm-todo-link { flex-shrink: 0; cursor: pointer; color: var(--text-accent); font-size: 14px; opacity: 0.7; }
.avm-todo-link:hover { opacity: 1; }
.avm-todo-delete { flex-shrink: 0; cursor: pointer; color: var(--text-muted); font-size: 12px; opacity: 0; padding: 2px 4px; }
.avm-todo-item:hover .avm-todo-delete { opacity: 0.6; }
.avm-todo-delete:hover { opacity: 1 !important; color: #ef4444; }

.avm-todo-display-wrap { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.avm-todo-edit-btn { flex-shrink: 0; cursor: pointer; color: var(--text-muted); font-size: 12px; opacity: 0; padding: 2px 4px; }
.avm-todo-item:hover .avm-todo-edit-btn { opacity: 0.6; }
.avm-todo-edit-btn:hover { opacity: 1 !important; color: var(--interactive-accent); }

.avm-todo-edit-container { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.avm-todo-edit-content { padding: 4px 8px; font-size: 13px; border: 1px solid var(--interactive-accent); border-radius: 4px; background: var(--background-primary); }
.avm-todo-edit-row { display: flex; gap: 6px; }
.avm-todo-edit-btns { display: flex; gap: 6px; justify-content: flex-end; }
.avm-todo-save-btn { padding: 3px 12px; font-size: 12px; background: var(--interactive-accent); color: white; border: none; border-radius: 4px; cursor: pointer; }
.avm-todo-cancel-btn { padding: 3px 12px; font-size: 12px; background: var(--background-modifier-hover); color: var(--text-muted); border: none; border-radius: 4px; cursor: pointer; }

.avm-todo-footer { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--background-modifier-border); flex-shrink: 0; }
.avm-todo-input-row { display: flex; gap: 8px; }
.avm-todo-input { flex: 1; padding: 6px 10px; font-size: 13px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); }
.avm-todo-extra-row { display: flex; gap: 8px; }
.avm-todo-input-link { flex: 1; padding: 5px 8px; font-size: 12px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); }
.avm-todo-input-date { width: 140px; padding: 5px 8px; font-size: 12px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); flex-shrink: 0; }
.avm-todo-add-btn { padding: 6px 14px; font-size: 13px; background: var(--interactive-accent); color: white; border: none; border-radius: 4px; cursor: pointer; }

/* Todo badge on project cards */
.avm-todo-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 11px; cursor: pointer; background: var(--background-modifier-hover); color: var(--text-muted); }
.avm-todo-badge.has-overdue { background: #fef2f2; color: #ef4444; }
`;
