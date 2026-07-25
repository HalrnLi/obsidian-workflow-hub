/**
 * Runtime type guards for frontmatter parsing.
 * Replaces `as any` casts with validated narrowing.
 */

import { App, Version, Project, ProjectLink, ProjectInfoItem, ProgressHistoryItem } from '../types';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringField(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value !== null && value !== undefined && typeof value !== 'boolean') return String(value);
  return fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// ProjectLink
// ---------------------------------------------------------------------------

export function isProjectLink(value: unknown): value is ProjectLink {
  if (!isPlainObject(value)) return false;
  const appId = value['appId'];
  const versionId = value['versionId'];
  return typeof appId === 'string' && appId !== '' && typeof versionId === 'string' && versionId !== '';
}

export function parseProjectLinks(raw: unknown): ProjectLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isProjectLink);
}

// ---------------------------------------------------------------------------
// ProjectInfoItem
// ---------------------------------------------------------------------------

export function isProjectInfoItem(value: unknown): value is ProjectInfoItem {
  if (!isPlainObject(value)) return false;
  const description = value['description'];
  if (typeof description !== 'string' || !description.trim()) return false;
  const link = value['link'];
  return typeof link === 'string';
}

export function parseProjectInfo(raw: unknown): ProjectInfoItem[] {
  if (!Array.isArray(raw)) return [];
  const result: ProjectInfoItem[] = [];
  for (const item of raw) {
    if (isPlainObject(item)) {
      const description = asString(item['description']);
      if (description && description.trim()) {
        result.push({ description, link: asStringField(item['link'], '') });
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// ProgressHistoryItem
// ---------------------------------------------------------------------------

export function parseProgressHistoryTyped(raw: unknown): ProgressHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const history: ProgressHistoryItem[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const at = item.lastIndexOf('@');
      if (at > 0) {
        history.push({ progress: item.slice(0, at), changedAt: item.slice(at + 1) });
      }
    } else if (isPlainObject(item)) {
      const progress = asString(item['progress']);
      const changedAt = asString(item['changedAt']);
      if (progress && changedAt) {
        history.push({ progress, changedAt });
      }
    }
  }
  return history;
}

// ---------------------------------------------------------------------------
// Entity field extractors (used by DataService parsers)
// ---------------------------------------------------------------------------

export function extractAppFields(fm: Record<string, unknown>, basename: string, ctime: number, mtime: number): App {
  return {
    id: asStringField(fm['id'] as unknown as string, basename),
    name: asStringField(fm['name'] as unknown as string, basename),
    createdAt: asStringField(fm['createdAt'] as unknown as string, ctime.toString()),
    updatedAt: asStringField(fm['updatedAt'] as unknown as string, mtime.toString()),
    version: asNumber(fm['version'], 1),
  };
}

export function extractVersionFields(fm: Record<string, unknown>, ctime: number, mtime: number): Version | null {
  const id = asString(fm['id']);
  if (!id) return null;
  const appId = asString(fm['appId']);
  if (!appId) return null;
  return {
    id,
    appId,
    versionNumber: asStringField(fm['versionNumber'] as unknown as string, ''),
    bllVersion: asStringField(fm['bllVersion'] as unknown as string, ''),
    ippVersion: asStringField(fm['ippVersion'] as unknown as string, ''),
    webVersion: asStringField(fm['webVersion'] as unknown as string, ''),
    updateContent: asStringField(fm['updateContent'] as unknown as string, ''),
    isArchived: asBoolean(fm['isArchived']),
    createdAt: asStringField(fm['createdAt'] as unknown as string, ctime.toString()),
    updatedAt: asStringField(fm['updatedAt'] as unknown as string, mtime.toString()),
    version: asNumber(fm['version'], 1),
  };
}

export function extractProjectFields(
  fm: Record<string, unknown>,
  ctime: number,
  mtime: number,
  firstProgress: string,
): Project {
  return {
    id: asStringField(fm['id'] as unknown as string, ''),
    name: asStringField(fm['name'] as unknown as string, ''),
    appVersionLinks: parseProjectLinks(fm['appVersionLinks']),
    manager: asStringField(fm['manager'] as unknown as string, ''),
    responsiblePerson: asStringField(fm['responsiblePerson'] as unknown as string, ''),
    projectLink: asStringField(fm['projectLink'] as unknown as string, ''),
    componentLink: asStringField(fm['componentLink'] as unknown as string, ''),
    features: asStringField(fm['features'] as unknown as string, ''),
    spec: asStringField(fm['spec'] as unknown as string, ''),
    requirements: asStringField(fm['requirements'] as unknown as string, ''),
    progress: asStringField(fm['progress'] as unknown as string, firstProgress),
    progressHistory: parseProgressHistoryTyped(fm['progressHistory']),
    b1IntegrationTestTime: asStringField(fm['b1IntegrationTestTime'] as unknown as string, ''),
    b1SystemTestTime: asStringField(fm['b1SystemTestTime'] as unknown as string, ''),
    b2IntegrationTestTime: asStringField(fm['b2IntegrationTestTime'] as unknown as string, ''),
    b2SystemTestTime: asStringField(fm['b2SystemTestTime'] as unknown as string, ''),
    b3IntegrationTestTime: asStringField(fm['b3IntegrationTestTime'] as unknown as string, ''),
    b3SystemTestTime: asStringField(fm['b3SystemTestTime'] as unknown as string, ''),
    b4IntegrationTestTime: asStringField(fm['b4IntegrationTestTime'] as unknown as string, ''),
    b4SystemTestTime: asStringField(fm['b4SystemTestTime'] as unknown as string, ''),
    actualReleaseTime: asStringField(fm['actualReleaseTime'] as unknown as string, ''),
    projectInfo: parseProjectInfo(fm['projectInfo']),
    createdAt: asStringField(fm['createdAt'] as unknown as string, ctime.toString()),
    updatedAt: asStringField(fm['updatedAt'] as unknown as string, mtime.toString()),
    version: asNumber(fm['version'], 1),
  };
}
