export const ARCHIVED = `
/* Archived projects view */
.avm-archived-main {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.avm-archived-search-bar {
  padding: 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  flex-shrink: 0;
}
.avm-archived-list { flex: 1; overflow-y: auto; padding: 12px; min-height: 0; }
.avm-archived-items { display: flex; flex-direction: column; gap: 8px; }

.avm-archived-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
}
.avm-archived-item:hover { background: var(--background-modifier-hover); }

.avm-archived-name { font-weight: 600; min-width: 180px; }
.avm-archived-manager { color: var(--text-muted); font-size: 13px; min-width: 100px; }
.avm-archived-date { color: var(--text-muted); font-size: 12px; min-width: 120px; }
.avm-archived-app { color: var(--interactive-accent); font-size: 12px; }
.avm-archived-actions { margin-left: auto; display: flex; gap: 4px; }
`;
