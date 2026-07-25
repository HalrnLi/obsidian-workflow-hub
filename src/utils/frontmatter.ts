import { parseYaml, stringifyYaml } from 'obsidian';

/**
 * frontmatter 解析/序列化（基于 Obsidian 原生 parseYaml/stringifyYaml）。
 * 替代早期自研解析器，彻底消除转义/类型/CRLF 问题。
 */

// js-yaml 会把 YAML 日期/时间戳字面量解析为 Date 对象，这里转回字符串：
// 纯日期（午夜 UTC）→ 'YYYY-MM-DD'；带时间 → 完整 ISO
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertDates(obj: any): any {
  if (obj instanceof Date) {
    const iso = obj.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (Array.isArray(obj)) return obj.map(convertDates);
  if (obj && typeof obj === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) result[k] = convertDates(v);
    return result;
  }
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseFrontmatter(content: string): Record<string, any> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  try {
    const parsed = convertDates(parseYaml(match[1]));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    console.error('[frontmatter] parseYaml failed:', e);
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createFrontmatter(data: Record<string, any>): string {
  return `---\n${stringifyYaml(data).trim()}\n---\n\n`;
}

export interface ProgressHistoryItem {
  progress: string;
  changedAt: string;
}

export function parseProgressHistory(raw: unknown): ProgressHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const history: ProgressHistoryItem[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const at = item.lastIndexOf('@');
      if (at > 0) {
        const progress = item.slice(0, at);
        const changedAt = item.slice(at + 1);
        history.push({ progress, changedAt });
      }
    } else if (item && typeof item === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const progress = (item as any).progress;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const changedAt = (item as any).changedAt;
      if (typeof progress === 'string' && typeof changedAt === 'string') {
        history.push({ progress, changedAt });
      }
    }
  }
  return history;
}

export function parseNumericField(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
