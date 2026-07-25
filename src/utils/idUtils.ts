export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function sanitizeFileName(name: string): string {
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  const safe = cleaned || 'unnamed';
  const withoutReserved = reserved.test(safe) ? `_${safe}` : safe;
  return withoutReserved.slice(0, 120);
}

export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [main, prerelease] = v.split('-', 2);
    const nums = main.split('.').map((part) => {
      const n = Number(part);
      return Number.isFinite(n) ? n : 0;
    });
    return { nums, prerelease: prerelease ?? '' };
  };
  const va = parse(a);
  const vb = parse(b);
  const maxLength = Math.max(va.nums.length, vb.nums.length);
  for (let i = 0; i < maxLength; i++) {
    const na = va.nums[i] ?? 0;
    const nb = vb.nums[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  if (va.prerelease && !vb.prerelease) return -1;
  if (!va.prerelease && vb.prerelease) return 1;
  return va.prerelease.localeCompare(vb.prerelease);
}
