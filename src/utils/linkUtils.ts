import { Notice } from 'obsidian';

export function openExternalLink(rawUrl: string): void {
  // 显式 scheme 白名单：只允许 http/https，防止 javascript: 等被前缀成 https://javascript:... 绕过
  if (!/^https?:\/\//i.test(rawUrl)) {
    // 无 scheme 的纯域名才补 https://，含其他 scheme 的一律拒绝
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl)) {
      new Notice('仅允许打开 http/https 链接');
      return;
    }
  }
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
