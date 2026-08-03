// 本测试只使用 Node API（fs/path/os）并调用 esbuild，需要 Node 环境
// （jsdom 的 TextEncoder 会导致 esbuild JS API 的 invariant 检查失败）
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test suite for fsUtils — verifies that the wrapper functions correctly
 * delegate to the real `fs` module via `require()`.
 *
 * The key fix: fsUtils uses `require('fs')` internally instead of top-level
 * `import ... from 'fs'` OR dynamic `await import('fs')`, which prevents the
 * "Failed to resolve module specifier 'fs'" error in Obsidian's renderer:
 * esbuild keeps dynamic imports of external modules as native `import("fs")`
 * in the CJS bundle, and Chromium cannot resolve bare specifiers.
 */

// Create a temporary directory for test files
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsutils-test-'));
});

afterEach(() => {
  // Clean up temp directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('fsUtils', () => {
  // Dynamically import the module under test
  let fsUtils: typeof import('../../src/utils/fsUtils');

  beforeEach(async () => {
    fsUtils = await import('../../src/utils/fsUtils');
  });

  describe('existsSync', () => {
    it('returns true for an existing file', () => {
      const filePath = path.join(tmpDir, 'exists.md');
      fs.writeFileSync(filePath, 'hello', 'utf-8');
      expect(fsUtils.existsSync(filePath)).toBe(true);
    });

    it('returns false for a non-existing file', () => {
      const filePath = path.join(tmpDir, 'nonexistent.md');
      expect(fsUtils.existsSync(filePath)).toBe(false);
    });

    it('returns true for an existing directory', () => {
      const dirPath = path.join(tmpDir, 'subdir');
      fs.mkdirSync(dirPath);
      expect(fsUtils.existsSync(dirPath)).toBe(true);
    });
  });

  describe('readFileSync', () => {
    it('reads file content as UTF-8 string', () => {
      const filePath = path.join(tmpDir, 'read-test.md');
      const content = '# Hello\n\nThis is a test file.';
      fs.writeFileSync(filePath, content, 'utf-8');
      expect(fsUtils.readFileSync(filePath)).toBe(content);
    });

    it('reads empty file as empty string', () => {
      const filePath = path.join(tmpDir, 'empty.md');
      fs.writeFileSync(filePath, '', 'utf-8');
      expect(fsUtils.readFileSync(filePath)).toBe('');
    });

    it('reads Chinese content correctly', () => {
      const filePath = path.join(tmpDir, 'chinese.md');
      const content = '测试内容\n第二行';
      fs.writeFileSync(filePath, content, 'utf-8');
      expect(fsUtils.readFileSync(filePath)).toBe(content);
    });
  });

  describe('writeFileSync', () => {
    it('writes content to a new file', () => {
      const filePath = path.join(tmpDir, 'write-test.md');
      const content = 'written content';
      fsUtils.writeFileSync(filePath, content);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(content);
    });

    it('overwrites existing file content', () => {
      const filePath = path.join(tmpDir, 'overwrite.md');
      fs.writeFileSync(filePath, 'old', 'utf-8');
      fsUtils.writeFileSync(filePath, 'new');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new');
    });

    it('writes Chinese content correctly', () => {
      const filePath = path.join(tmpDir, 'chinese-write.md');
      const content = '中文写入测试';
      fsUtils.writeFileSync(filePath, content);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(content);
    });
  });

  describe('mkdirSync', () => {
    it('creates a new directory', () => {
      const dirPath = path.join(tmpDir, 'newdir');
      fsUtils.mkdirSync(dirPath, { recursive: true });
      expect(fs.existsSync(dirPath)).toBe(true);
      expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    it('creates nested directories recursively', () => {
      const dirPath = path.join(tmpDir, 'a', 'b', 'c');
      fsUtils.mkdirSync(dirPath, { recursive: true });
      expect(fs.existsSync(dirPath)).toBe(true);
      expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });
  });

  describe('unlinkSync', () => {
    it('deletes an existing file', () => {
      const filePath = path.join(tmpDir, 'to-delete.md');
      fs.writeFileSync(filePath, 'delete me', 'utf-8');
      fsUtils.unlinkSync(filePath);
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe('readdirSync', () => {
    it('lists directory contents', () => {
      fs.writeFileSync(path.join(tmpDir, 'a.md'), '', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'b.md'), '', 'utf-8');
      fs.mkdirSync(path.join(tmpDir, 'subdir'));
      const items = fsUtils.readdirSync(tmpDir);
      expect(items).toContain('a.md');
      expect(items).toContain('b.md');
      expect(items).toContain('subdir');
    });

    it('returns empty array for empty directory', () => {
      const emptyDir = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyDir);
      expect(fsUtils.readdirSync(emptyDir)).toEqual([]);
    });
  });

  describe('statSync', () => {
    it('returns stats for a file', () => {
      const filePath = path.join(tmpDir, 'stat-test.md');
      fs.writeFileSync(filePath, 'content', 'utf-8');
      const stat = fsUtils.statSync(filePath);
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
    });

    it('returns stats for a directory', () => {
      const dirPath = path.join(tmpDir, 'stat-dir');
      fs.mkdirSync(dirPath);
      const stat = fsUtils.statSync(dirPath);
      expect(stat.isDirectory()).toBe(true);
      expect(stat.isFile()).toBe(false);
    });
  });

  describe('copyFileSync', () => {
    it('copies a file', () => {
      const src = path.join(tmpDir, 'source.md');
      const dest = path.join(tmpDir, 'dest.md');
      const content = 'copy me';
      fs.writeFileSync(src, content, 'utf-8');
      fsUtils.copyFileSync(src, dest);
      expect(fs.readFileSync(dest, 'utf-8')).toBe(content);
      // Original should still exist
      expect(fs.readFileSync(src, 'utf-8')).toBe(content);
    });
  });

  describe('async wrappers', () => {
    describe('writeFileAsync', () => {
      it('writes content to a new file', async () => {
        const filePath = path.join(tmpDir, 'async-write.md');
        await fsUtils.writeFileAsync(filePath, 'async content');
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('async content');
      });
    });

    describe('readFileAsync', () => {
      it('reads file content', async () => {
        const filePath = path.join(tmpDir, 'async-read.md');
        fs.writeFileSync(filePath, 'async read content', 'utf-8');
        const content = await fsUtils.readFileAsync(filePath);
        expect(content).toBe('async read content');
      });
    });

    describe('mkdirAsync', () => {
      it('creates nested directories', async () => {
        const dirPath = path.join(tmpDir, 'x', 'y', 'z');
        await fsUtils.mkdirAsync(dirPath, { recursive: true });
        expect(fs.existsSync(dirPath)).toBe(true);
      });
    });

    describe('unlinkAsync', () => {
      it('deletes a file', async () => {
        const filePath = path.join(tmpDir, 'async-delete.md');
        fs.writeFileSync(filePath, 'delete', 'utf-8');
        await fsUtils.unlinkAsync(filePath);
        expect(fs.existsSync(filePath)).toBe(false);
      });
    });

    describe('renameAsync', () => {
      it('renames a file', async () => {
        const oldPath = path.join(tmpDir, 'old-name.md');
        const newPath = path.join(tmpDir, 'new-name.md');
        fs.writeFileSync(oldPath, 'rename me', 'utf-8');
        await fsUtils.renameAsync(oldPath, newPath);
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(fs.readFileSync(newPath, 'utf-8')).toBe('rename me');
      });
    });

    describe('readdirAsync', () => {
      it('lists directory contents', async () => {
        fs.writeFileSync(path.join(tmpDir, 'async-a.md'), '', 'utf-8');
        fs.writeFileSync(path.join(tmpDir, 'async-b.md'), '', 'utf-8');
        const items = await fsUtils.readdirAsync(tmpDir);
        expect(items).toContain('async-a.md');
        expect(items).toContain('async-b.md');
      });
    });

    describe('statAsync', () => {
      it('returns file stats', async () => {
        const filePath = path.join(tmpDir, 'async-stat.md');
        fs.writeFileSync(filePath, 'content', 'utf-8');
        const stat = await fsUtils.statAsync(filePath);
        expect(stat.isFile()).toBe(true);
      });
    });

    describe('existsAsync', () => {
      it('returns true for existing file', async () => {
        const filePath = path.join(tmpDir, 'async-exists.md');
        fs.writeFileSync(filePath, 'content', 'utf-8');
        expect(await fsUtils.existsAsync(filePath)).toBe(true);
      });

      it('returns false for non-existing file', async () => {
        const filePath = path.join(tmpDir, 'async-nonexistent.md');
        expect(await fsUtils.existsAsync(filePath)).toBe(false);
      });
    });
  });

  describe('fs 模块解析（Obsidian 浏览器环境兼容）', () => {
    it('源码不得包含顶层 `import ... from "fs"`（会破坏 esbuild 打包）', () => {
      const moduleSource = fs.readFileSync(path.resolve(__dirname, '../../src/utils/fsUtils.ts'), 'utf-8');
      expect(moduleSource).not.toMatch(/^import\s+.*from\s+['"]fs['"]/m);
      // 必须通过 require('fs') 获取模块
      expect(moduleSource).toContain("require('fs')");
    });

    it('源码不得包含运行时动态 `await import("fs")`（会泄漏为原生 import，运行时报 "Failed to resolve module specifier"）', () => {
      const moduleSource = fs.readFileSync(path.resolve(__dirname, '../../src/utils/fsUtils.ts'), 'utf-8');
      // 注意：`typeof import('fs')` / `import('fs').Stats` 是类型注解，不算运行时导入；
      // 文档注释中的说明文字也不在此列
      expect(moduleSource).not.toMatch(/=\s*await\s+import\(\s*['"]fs['"]\s*\)/);
      expect(moduleSource).not.toContain('getFsAsync');
    });

    it('esbuild 打包产物（format=cjs + fs external）包含 require("fs") 且不含 import("fs")', async () => {
      // 与 esbuild.config.mjs 的关键配置保持一致：cjs 格式、es2018、fs 为 external
      const esbuild = await import('esbuild');
      const source = fs.readFileSync(path.resolve(__dirname, '../../src/utils/fsUtils.ts'), 'utf-8');
      const result = await esbuild.build({
        stdin: { contents: source, sourcefile: 'fsUtils.ts', loader: 'ts' },
        bundle: true,
        format: 'cjs',
        target: 'es2018',
        external: ['fs'],
        write: false,
        logLevel: 'silent',
      });
      const code = result.outputFiles[0].text;
      expect(code).toContain('require("fs")');
      // 回归保护：一旦产物出现 import("fs")，Obsidian 渲染进程就会报
      // "Failed to resolve module specifier 'fs'"
      expect(code).not.toContain('import("fs")');
    });
  });
});
