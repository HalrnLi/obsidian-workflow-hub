/**
 * Path resolution for the plugin's data directory.
 * Handles both relative (Obsidian vault) and absolute (filesystem) paths,
 * including Windows drive letters and UNC paths.
 */

import { normalizePath } from 'obsidian';
import { join, isAbsolute } from 'path';

export class FilePathResolver {
  constructor(private getDataPath: () => string) {}

  /** The configured data path (relative vault path or absolute filesystem path). */
  getDataPathValue(): string {
    return this.getDataPath();
  }

  /** True when the data path is an absolute filesystem path (incl. Windows drive letters). */
  isAbsolutePath(): boolean {
    const path = this.getDataPathValue();
    return isAbsolute(path) || /^[A-Za-z]:/.test(path);
  }

  /**
   * Join path segments. Relative paths are normalized via Obsidian's normalizePath;
   * absolute paths (incl. Windows UNC like \\server\share) are left untouched
   * to avoid mangling UNC prefixes.
   */
  joinPath(...parts: string[]): string {
    const joined = join(...parts);
    return isAbsolute(joined) ? joined : normalizePath(joined);
  }

  getAppsFolder(): string {
    return this.joinPath(this.getDataPathValue(), 'apps');
  }

  getVersionsFolder(): string {
    return this.joinPath(this.getDataPathValue(), 'versions');
  }

  getProjectsFolder(): string {
    return this.joinPath(this.getDataPathValue(), 'projects');
  }

  getTodosFolder(): string {
    return this.joinPath(this.getDataPathValue(), 'todos');
  }

  getCategoriesFolder(): string {
    return this.joinPath(this.getDataPathValue(), 'categories');
  }
}
