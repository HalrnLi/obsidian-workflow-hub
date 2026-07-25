import { describe, it, expect } from 'vitest';
import { generateId, sanitizeFileName, compareVersions } from '../../src/utils/idUtils';

describe('generateId', () => {
  it('returns a string', () => {
    expect(typeof generateId()).toBe('string');
  });

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it('returns a UUID-like string when crypto is available', () => {
    const id = generateId();
    expect(id.length).toBeGreaterThan(10);
    expect(id).toContain('-');
  });
});

describe('sanitizeFileName', () => {
  it('removes forbidden characters', () => {
    expect(sanitizeFileName('test:file')).toBe('test_file');
    expect(sanitizeFileName('a/b/c')).toBe('a_b_c');
    expect(sanitizeFileName('name?query')).toBe('name_query');
  });

  it('trims trailing dots and spaces', () => {
    // Multiple dots get collapsed to _ first, then trailing dots/spaces removed
    expect(sanitizeFileName('name...')).toBe('name_');
    expect(sanitizeFileName('name   ')).toBe('name');
    expect(sanitizeFileName('name.')).toBe('name');
    expect(sanitizeFileName('name .')).toBe('name');
  });

  it('handles empty input', () => {
    expect(sanitizeFileName('')).toBe('unnamed');
    expect(sanitizeFileName('   ')).toBe('unnamed');
  });

  it('handles reserved names', () => {
    // CON is a reserved name on Windows
    const result = sanitizeFileName('con');
    expect(result).toBe('_con');
  });

  it('truncates to 120 characters', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeFileName(long).length).toBeLessThanOrEqual(120);
  });

  it('preserves Chinese characters', () => {
    expect(sanitizeFileName('测试项目')).toBe('测试项目');
  });

  it('handles null input', () => {
    expect(sanitizeFileName(null as any)).toBe('unnamed');
  });

  it('handles undefined input', () => {
    expect(sanitizeFileName(undefined as any)).toBe('unnamed');
  });

  it('handles numeric input', () => {
    expect(sanitizeFileName(123 as any)).toBe('123');
  });

  it('handles object input', () => {
    // YAML 解析可能返回对象，确保不会抛异常
    expect(sanitizeFileName({} as any)).toBe('[object Object]');
  });

  it('handles array input', () => {
    expect(sanitizeFileName([] as any)).toBe('unnamed');
  });
});

describe('compareVersions', () => {
  it('returns negative when a < b', () => {
    expect(compareVersions('1.0', '2.0')).toBeLessThan(0);
    expect(compareVersions('1.0', '1.1')).toBeLessThan(0);
  });

  it('returns positive when a > b', () => {
    expect(compareVersions('2.0', '1.0')).toBeGreaterThan(0);
    expect(compareVersions('1.1', '1.0')).toBeGreaterThan(0);
  });

  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('handles different segment counts', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
  });

  it('handles pre-release versions', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
  });

  it('handles non-numeric segments', () => {
    // Non-numeric parts become 0
    expect(compareVersions('abc', 'xyz')).toBe(0);
  });
});
