import { Notice } from 'obsidian';

export function openExternalLink(rawUrl: string): void {
  const normalized = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      new Notice('仅允许打开 http/https 链接');
      return;
    }
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  } catch {
    new Notice('链接格式无效');
  }
}
