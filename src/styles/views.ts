export const VIEWS = `
/* Kanban View */
.avm-kanban {
  display: flex;
  height: 100%;
  overflow-x: auto;
  padding: 12px;
  gap: 12px;
}

.avm-kanban-column {
  min-width: 250px;
  max-width: 300px;
  background: var(--background-secondary);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}

.avm-kanban-column-header {
  padding: 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  display: flex;
  align-items: center;
  gap: 8px;
}

.avm-kanban-column-title { font-weight: 600; font-size: 13px; }

.avm-kanban-column-count {
  background: var(--background-modifier-border);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  color: var(--text-muted);
}

.avm-kanban-column-indicator { width: 4px; height: 16px; border-radius: 2px; margin-left: auto; }
.avm-kanban-cards { flex: 1; overflow-y: auto; padding: 8px; }
.avm-kanban-empty { text-align: center; padding: 16px; color: var(--text-muted); font-size: 12px; }

.avm-kanban-card {
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: box-shadow 0.15s;
}
.avm-kanban-card:hover { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); }
.avm-kanban-card.avm-overdue { border-color: #ef4444; }
.avm-kanban-card.avm-highlighted-row {
  border-color: #ef4444;
  border-width: 2px;
  background: rgba(239, 68, 68, 0.05);
}

.avm-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
.avm-card-title { font-weight: 600; font-size: 13px; flex: 1; }
.avm-card-version { font-size: 11px; color: var(--text-muted); background: var(--background-modifier-border); padding: 2px 6px; border-radius: 4px; }
.avm-card-meta { font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
.avm-card-links { display: flex; gap: 8px; margin-top: 6px; }

/* Table View */
.avm-table-view { height: 100%; overflow: auto; }
.avm-table-wrapper { min-width: 100%; }

.avm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.avm-table th {
  text-align: left;
  padding: 12px;
  background: var(--background-secondary);
  border-bottom: 2px solid var(--background-modifier-border);
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}

.avm-table td { padding: 10px 12px; border-bottom: 1px solid var(--background-modifier-border); vertical-align: middle; }
.avm-table tr { content-visibility: auto; contain-intrinsic-size: 50px; }
.avm-table tr:hover { background: var(--background-modifier-hover); }
.avm-table tr.avm-overdue-row { background: rgba(239, 68, 68, 0.05); }
.avm-table tr.avm-overdue-row:hover { background: rgba(239, 68, 68, 0.1); }
.avm-table tr.avm-highlighted-row { background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; }
.avm-table tr.avm-highlighted-row:hover { background: rgba(239, 68, 68, 0.15); }
.avm-table tr.avm-selected-row { background: rgba(99, 102, 241, 0.08); border-left: 3px solid var(--interactive-accent); }
.avm-table tr.avm-selected-row:hover { background: rgba(99, 102, 241, 0.14); }

.avm-cell-name { font-weight: 500; }
.avm-cell-links { display: flex; gap: 8px; }
.avm-cell-actions { display: flex; gap: 4px; }

.avm-btn-small { padding: 4px 8px; border: none; background: var(--background-modifier-border); border-radius: 4px; cursor: pointer; font-size: 12px; }
.avm-btn-small:hover { background: var(--background-modifier-hover); }
.avm-btn-danger:hover { background: rgba(239, 68, 68, 0.2); }

/* Gantt View (disabled — preserved for future use) */
.avm-gantt { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.avm-gantt-header { padding: 12px; border-bottom: 1px solid var(--background-modifier-border); background: var(--background-primary); }
.avm-gantt-title { font-size: 16px; font-weight: 600; }
.avm-gantt-chart { flex: 1; overflow: hidden; display: flex; }

.avm-gantt-sidebar { width: 280px; min-width: 280px; flex-shrink: 0; border-right: 1px solid var(--background-modifier-border); background: var(--background-secondary); display: flex; flex-direction: column; overflow-y: auto; }
.avm-gantt-timeline-container { flex: 1; overflow-x: hidden; overflow-y: auto; display: flex; flex-direction: column; }
.avm-gantt-timeline-header { display: flex; position: sticky; top: 0; z-index: 10; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); }
.avm-gantt-sidebar-header { height: 40px; min-height: 40px; display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid var(--background-modifier-border); font-weight: 600; font-size: 13px; background: var(--background-secondary); position: sticky; top: 0; z-index: 10; box-sizing: border-box; }

.avm-gantt-timeline { display: flex; }
.avm-gantt-day-cell { height: 40px; display: flex; align-items: center; justify-content: center; border-right: 1px solid var(--background-modifier-border); font-size: 11px; color: var(--text-muted); box-sizing: border-box; }
.avm-gantt-day-cell.avm-gantt-weekend { background: var(--background-modifier-hover); }
.avm-gantt-day-cell.avm-gantt-today { background: rgba(99, 102, 241, 0.2); color: var(--interactive-accent); font-weight: 600; }
.avm-gantt-date-label { white-space: nowrap; }

.avm-gantt-row { display: flex; border-bottom: 1px solid var(--background-modifier-border); height: 40px; min-height: 40px; align-items: stretch; }
.avm-gantt-row:hover { background: var(--background-modifier-hover); }

.avm-gantt-sidebar-row { width: 280px; min-width: 280px; height: 40px; min-height: 40px; padding: 0 12px; border-right: 1px solid var(--background-modifier-border); display: flex; flex-direction: column; justify-content: center; gap: 2px; background: var(--background-secondary); box-sizing: border-box; }
.avm-gantt-project-name { font-weight: 500; font-size: 13px; white-space: normal; word-break: break-word; }
.avm-gantt-project-version { font-size: 11px; color: var(--text-muted); }

.avm-gantt-cells { display: flex; position: relative; overflow: hidden; }
.avm-gantt-time-cell { width: 40px; min-width: 40px; height: 40px; border-right: 1px solid var(--background-modifier-border); box-sizing: border-box; }

.avm-gantt-bar { position: absolute; height: 24px; border-radius: 4px; display: flex; align-items: center; padding: 0 8px; cursor: pointer; transition: opacity 0.15s; overflow: hidden; }
.avm-gantt-bar:hover { opacity: 0.85; }
.avm-gantt-bar-label { font-size: 11px; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.avm-gantt-empty { text-align: center; padding: 48px; color: var(--text-muted); font-size: 14px; }

.avm-gantt-project-bar { position: absolute; display: flex; align-items: center; cursor: pointer; transition: opacity 0.15s; overflow: visible; }
.avm-gantt-project-bar:hover { opacity: 0.85; }
.avm-gantt-marker { position: absolute; width: 12px; height: 12px; top: 50%; transform: translateX(-50%) translateY(-50%) rotate(45deg); border-radius: 2px; border: 2px solid white; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
`;
