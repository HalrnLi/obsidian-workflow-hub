/**
 * 统一时间工具：ISO 8601 格式化、多源格式解析与转换。
 *
 * 目标格式：ISO 8601 UTC，如 2026-07-22T08:30:00.000Z
 * 用于统一 todolist（YYYY-MM-DD HH:MM）与 AVM（毫秒时间戳字符串/ISO）的时间戳。
 */

/** 当前时间 ISO 字符串 */
export function nowISO(): string {
  return new Date().toISOString();
}

/** 格式化为 YYYY-MM-DD（本地日期） */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 今天的 YYYY-MM-DD */
export function todayStr(): string {
  return formatDate(new Date());
}

/**
 * 将任意源时间戳转换为 ISO 8601 UTC。
 *
 * 支持的源格式：
 *  - 毫秒时间戳字符串（13 位数字，AVM DataService 用 Date.now().toString()）
 *  - ISO 8601（已是目标格式，原样返回）
 *  - YYYY-MM-DD HH:MM（todolist 用，当作本地时间）
 *  - YYYY-MM-DD HH:MM:SS（带秒）
 *  - YYYY-MM-DD（日期，当作本地 00:00）
 *  - 空值（null/undefined/''）返回 ''
 *  - 无法识别：警告 + 用当前时间兜底
 */
export function toISO(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';

  const str = String(value).trim();
  if (str === '') return '';

  // 毫秒时间戳字符串（13 位数字）—— AVM DataService 的 Date.now().toString()
  if (/^\d{13}$/.test(str)) {
    return new Date(Number(str)).toISOString();
  }

  // ISO 8601（已是目标格式，原样返回）—— AVM TodoService 的 new Date().toISOString()
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    return str;
  }

  // YYYY-MM-DD HH:MM（todolist 本地时间，来自 utils/date.js formatDateTime）
  const datetimeMatch = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (datetimeMatch) {
    const [, y, mo, d, h, mi] = datetimeMatch;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
    return date.toISOString();
  }

  // YYYY-MM-DD HH:MM:SS（带秒）
  const datetimeSecMatch = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (datetimeSecMatch) {
    const [, y, mo, d, h, mi, s] = datetimeSecMatch;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    return date.toISOString();
  }

  // YYYY-MM-DD（日期，当作本地 00:00）—— 日期字段保持 YYYY-MM-DD 不调用此函数，
  // 但若传入则当作本地 00:00 转 ISO
  const dateMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    const [, y, mo, d] = dateMatch;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0);
    return date.toISOString();
  }

  // 兜底：尝试 new Date 解析
  const fallback = new Date(str);
  if (!isNaN(fallback.getTime())) {
    return fallback.toISOString();
  }

  console.warn(`[dateUtils] 无法识别的时间格式: ${str}，使用当前时间兜底`);
  return nowISO();
}

/** 判断是否为有效的 ISO 字符串 */
export function isISO(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value);
}

/** 将 ISO 格式化为可读的本地日期时间 YYYY-MM-DD HH:MM */
export function formatISOToLocal(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  const h = date.getHours().toString().padStart(2, '0');
  const mi = date.getMinutes().toString().padStart(2, '0');
  return `${formatDate(date)} ${h}:${mi}`;
}

/** 将 ISO 格式化为本地日期 YYYY-MM-DD */
export function formatISOToDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return formatDate(date);
}
