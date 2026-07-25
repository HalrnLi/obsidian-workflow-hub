import { describe, it, expect } from 'vitest';
import {
  isProjectLink,
  parseProjectLinks,
  isProjectInfoItem,
  parseProjectInfo,
  parseProgressHistoryTyped,
  extractAppFields,
  extractVersionFields,
  extractProjectFields,
} from '../../src/utils/typeGuards';

describe('isProjectLink', () => {
  it('accepts valid link', () => {
    expect(isProjectLink({ appId: 'a1', versionId: 'v1' })).toBe(true);
  });
  it('rejects missing fields', () => {
    expect(isProjectLink({ appId: 'a1' })).toBe(false);
    expect(isProjectLink({ versionId: 'v1' })).toBe(false);
  });
  it('rejects empty strings', () => {
    expect(isProjectLink({ appId: '', versionId: 'v1' })).toBe(false);
    expect(isProjectLink({ appId: 'a1', versionId: '' })).toBe(false);
  });
  it('rejects non-object', () => {
    expect(isProjectLink(null)).toBe(false);
    expect(isProjectLink('string')).toBe(false);
    expect(isProjectLink([])).toBe(false);
  });
});

describe('parseProjectLinks', () => {
  it('filters invalid entries', () => {
    const raw = [{ appId: 'a1', versionId: 'v1' }, { appId: 'a2' }, { appId: '', versionId: 'v3' }, 'not an object'];
    const result = parseProjectLinks(raw);
    expect(result).toHaveLength(1);
    expect(result[0].appId).toBe('a1');
  });
  it('returns empty for non-array', () => {
    expect(parseProjectLinks(null)).toEqual([]);
    expect(parseProjectLinks('foo')).toEqual([]);
  });
});

describe('isProjectInfoItem', () => {
  it('accepts valid item', () => {
    expect(isProjectInfoItem({ description: 'memo', link: 'https://x.y' })).toBe(true);
    expect(isProjectInfoItem({ description: 'memo' })).toBe(false); // link required
  });
  it('rejects empty description', () => {
    expect(isProjectInfoItem({ description: '  ', link: '' })).toBe(false);
  });
});

describe('parseProjectInfo', () => {
  it('normalizes and filters', () => {
    const raw = [
      { description: 'note A', link: 'https://a' },
      { description: 'note B' }, // no link
      { description: '', link: 'https://c' }, // empty description
    ];
    const result = parseProjectInfo(raw);
    expect(result).toHaveLength(2);
    expect(result[1].link).toBe('');
  });
});

describe('parseProgressHistoryTyped', () => {
  it('parses string format "progress@timestamp"', () => {
    const result = parseProgressHistoryTyped(['需求分解@2026-01-01T00:00:00Z']);
    expect(result).toEqual([{ progress: '需求分解', changedAt: '2026-01-01T00:00:00Z' }]);
  });
  it('parses object format', () => {
    const result = parseProgressHistoryTyped([{ progress: '已发布', changedAt: '2026-02-01' }]);
    expect(result).toEqual([{ progress: '已发布', changedAt: '2026-02-01' }]);
  });
  it('skips malformed entries', () => {
    const result = parseProgressHistoryTyped(['no-at-sign', 42, null]);
    expect(result).toEqual([]);
  });
});

describe('extractAppFields', () => {
  it('extracts with fallbacks', () => {
    const result = extractAppFields({ name: 'MyApp' }, 'legacy-basename', 1000, 2000);
    expect(result.id).toBe('legacy-basename');
    expect(result.name).toBe('MyApp');
    expect(result.createdAt).toBe('1000');
    expect(result.version).toBe(1);
  });
  it('preserves provided id and timestamps', () => {
    const result = extractAppFields(
      { id: 'abc', createdAt: '2026-01-01', updatedAt: '2026-01-02', version: 5 },
      'bn',
      0,
      0,
    );
    expect(result.id).toBe('abc');
    expect(result.version).toBe(5);
  });
});

describe('extractVersionFields', () => {
  it('returns null when appId missing', () => {
    expect(extractVersionFields({}, 0, 0)).toBeNull();
  });
  it('extracts valid version', () => {
    const result = extractVersionFields({ id: 'v1', appId: 'a1', versionNumber: '1.0', isArchived: true }, 1000, 2000);
    expect(result).not.toBeNull();
    expect(result!.isArchived).toBe(true);
    expect(result!.versionNumber).toBe('1.0');
  });
});

describe('extractProjectFields', () => {
  it('fills defaults for minimal frontmatter', () => {
    const result = extractProjectFields({}, 0, 0, '需求分解');
    expect(result.progress).toBe('需求分解');
    expect(result.appVersionLinks).toEqual([]);
    expect(result.projectInfo).toEqual([]);
  });
  it('preserves provided fields', () => {
    const result = extractProjectFields(
      {
        id: 'p1',
        name: 'Project X',
        appVersionLinks: [{ appId: 'a1', versionId: 'v1' }],
        projectInfo: [{ description: 'memo', link: 'https://x' }],
      },
      0,
      0,
      '需求分解',
    );
    expect(result.id).toBe('p1');
    expect(result.name).toBe('Project X');
    expect(result.appVersionLinks).toHaveLength(1);
    expect(result.projectInfo).toHaveLength(1);
  });
});
