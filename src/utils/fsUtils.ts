/**
 * Filesystem utilities for absolute path mode.
 *
 * Obsidian plugins run in Electron's renderer process, where `fs` cannot be
 * loaded as a bare ES module specifier:
 *  - a top-level `import ... from 'fs'` breaks esbuild bundling;
 *  - `await import('fs')` is preserved by esbuild as a native `import("fs")`
 *    in the CJS bundle, and the renderer cannot resolve bare specifiers —
 *    executing it throws "Failed to resolve module specifier 'fs'".
 *
 * Obsidian's plugin scope provides a CommonJS `require` (the same one that
 * resolves `obsidian`/`path` in the bundle), so this module centralizes all
 * `fs` access behind `require('fs')`. The module is loaded lazily on first
 * use and cached for subsequent calls; async wrappers use the `.promises`
 * API of the same required module (never `import('fs')`).
 */

// Cached fs module (loaded lazily on first use)
let _fs: typeof import('fs') | null = null;

/**
 * Lazily load and cache the `fs` module via `require`.
 *
 * `require` is synchronous and works both in Obsidian's plugin scope
 * (Electron renderer) and in Node (vitest). We deliberately avoid
 * `await import('fs')` here — see the module-level comment for why it
 * breaks at runtime.
 */
function getFs(): typeof import('fs') {
  if (!_fs) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _fs = require('fs') as typeof import('fs');
  }
  return _fs;
}

// ---- Synchronous wrappers (for use in sync contexts) ----

/** Synchronously check if a path exists. */
export function existsSync(path: string): boolean {
  return getFs().existsSync(path);
}

/** Synchronously read a file as UTF-8 string. */
export function readFileSync(path: string, encoding: BufferEncoding = 'utf-8'): string {
  return getFs().readFileSync(path, encoding);
}

/** Synchronously write a UTF-8 string to a file. */
export function writeFileSync(path: string, content: string, encoding: BufferEncoding = 'utf-8'): void {
  getFs().writeFileSync(path, content, encoding);
}

/** Synchronously create a directory (recursive). */
export function mkdirSync(path: string, options?: { recursive?: boolean }): void {
  getFs().mkdirSync(path, options);
}

/** Synchronously delete a file. */
export function unlinkSync(path: string): void {
  getFs().unlinkSync(path);
}

/** Synchronously list directory contents. */
export function readdirSync(path: string): string[] {
  return getFs().readdirSync(path) as string[];
}

/** Synchronously get file/directory stats. */
export function statSync(path: string): import('fs').Stats {
  return getFs().statSync(path);
}

/** Synchronously copy a file. */
export function copyFileSync(src: string, dest: string): void {
  getFs().copyFileSync(src, dest);
}

// ---- Asynchronous wrappers (for use in async contexts) ----

/** Asynchronously write a UTF-8 string to a file. */
export async function writeFileAsync(path: string, content: string, encoding: BufferEncoding = 'utf-8'): Promise<void> {
  await getFs().promises.writeFile(path, content, encoding);
}

/** Asynchronously read a file as UTF-8 string. */
export async function readFileAsync(path: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
  return getFs().promises.readFile(path, encoding);
}

/** Asynchronously create a directory (recursive). */
export async function mkdirAsync(path: string, options?: { recursive?: boolean }): Promise<void> {
  await getFs().promises.mkdir(path, options);
}

/** Asynchronously delete a file. */
export async function unlinkAsync(path: string): Promise<void> {
  await getFs().promises.unlink(path);
}

/** Asynchronously rename/move a file. */
export async function renameAsync(oldPath: string, newPath: string): Promise<void> {
  await getFs().promises.rename(oldPath, newPath);
}

/** Asynchronously list directory contents. */
export async function readdirAsync(path: string): Promise<string[]> {
  return getFs().promises.readdir(path) as Promise<string[]>;
}

/** Asynchronously get file/directory stats. */
export async function statAsync(path: string): Promise<import('fs').Stats> {
  return getFs().promises.stat(path);
}

/** Asynchronously check if a path exists (via stats, non-throwing). */
export async function existsAsync(path: string): Promise<boolean> {
  try {
    await getFs().promises.stat(path);
    return true;
  } catch {
    return false;
  }
}
