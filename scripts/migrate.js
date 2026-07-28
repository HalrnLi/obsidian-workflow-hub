#!/usr/bin/env ts-node
"use strict";
/**
 * ============================================================================
 *  obsidian-workflow-hub 独立数据迁移脚本
 * ============================================================================
 *
 *  用途：将旧版 AVM (app-version-manager) 数据 + todolist tasks.json
 *        迁移到新版 obsidian-workflow-hub 数据格式。
 *
 *  用法：
 *    npx ts-node scripts/migrate.ts [选项]
 *
 *  选项：
 *    --vault <path>        Obsidian vault 路径（默认当前目录）
 *    --old-data <path>     旧 AVM 数据路径（相对 vault 或绝对路径，默认 app-version-manager）
 *    --new-data <path>     新数据路径（相对 vault 或绝对路径，默认 workflow-hub）
 *    --todolist <path>     todolist tasks.json 路径（默认 .obsidian/plugins/todolist/tasks.json）
 *    --dry-run             仅预览，不写入任何文件
 *    --skip-backup         跳过备份步骤
 *    --help                显示帮助
 *
 *  示例：
 *    npx ts-node scripts/migrate.ts --vault ~/ObsidianVault
 *    npx ts-node scripts/migrate.ts --vault ~/ObsidianVault --dry-run
 * ============================================================================
 */
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
// ============================================================================
// 工具函数
// ============================================================================
/**
 * 生成 UUID v4（兼容 Node.js 和浏览器环境）
 */
function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // 兜底实现
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
/**
 * 清理文件名中的非法字符
 */
function sanitizeFileName(name) {
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
/**
 * 将任意源时间戳转换为 ISO 8601 UTC
 */
function toISO(value) {
    if (value === null || value === undefined || value === '')
        return '';
    const str = String(value).trim();
    if (str === '')
        return '';
    // 毫秒时间戳字符串（13 位数字）
    if (/^\d{13}$/.test(str)) {
        return new Date(Number(str)).toISOString();
    }
    // 已经是 ISO 8601
    if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
        return str;
    }
    // YYYY-MM-DD HH:MM
    const datetimeMatch = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
    if (datetimeMatch) {
        const [, y, mo, d, h, mi] = datetimeMatch;
        const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
        return date.toISOString();
    }
    // YYYY-MM-DD HH:MM:SS
    const datetimeSecMatch = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (datetimeSecMatch) {
        const [, y, mo, d, h, mi, s] = datetimeSecMatch;
        const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
        return date.toISOString();
    }
    // YYYY-MM-DD（日期字段不调用此函数，但兜底处理）
    const dateMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateMatch) {
        const [, y, mo, d] = dateMatch;
        const date = new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0);
        return date.toISOString();
    }
    // 尝试 new Date 解析
    const fallback = new Date(str);
    if (!isNaN(fallback.getTime())) {
        return fallback.toISOString();
    }
    console.warn(`[dateUtils] 无法识别的时间格式: ${str}，使用当前时间兜底`);
    return new Date().toISOString();
}
/**
 * 当前 ISO 时间
 */
function nowISO() {
    return new Date().toISOString();
}
/**
 * 解析 YAML frontmatter（简化版，支持基本类型）
 */
function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match)
        return null;
    try {
        return parseSimpleYaml(match[1]);
    }
    catch (e) {
        console.error('[frontmatter] parse failed:', e);
        return null;
    }
}
/**
 * 简化 YAML 解析器（支持 string, number, boolean, array, 嵌套对象）
 * 改进版：正确处理数组内嵌套对象
 */
function parseSimpleYaml(yaml) {
    const result = {};
    const lines = yaml.split(/\r?\n/);
    const stack = [];
    let currentKey = null;
    let lastArrayKey = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#'))
            continue;
        const lineIndent = line.length - line.trimStart().length;
        // Pop stack if we've dedented
        while (stack.length > 0 && lineIndent <= stack[stack.length - 1].indent) {
            stack.pop();
        }
        // Determine current context
        let ctx = result;
        for (const frame of stack) {
            if (frame.type === 'array') {
                ctx = frame.data[frame.data.length - 1];
            }
            else {
                ctx = frame.data;
            }
        }
        // Array item
        const arrayMatch = trimmed.match(/^-\s+(.+)$/);
        if (arrayMatch) {
            const value = arrayMatch[1].trim();
            const targetCtx = (stack.length > 0 && stack[stack.length - 1].type === 'array') ? ctx : result;
            const arrayKey = lastArrayKey;
            if (!Array.isArray(targetCtx[arrayKey])) {
                targetCtx[arrayKey] = [];
            }
            // Check if this is an object entry (key: value on same line as -)
            const inlineObjMatch = value.match(/^(\w[\w-]*):\s*(.*)$/);
            if (inlineObjMatch && !value.startsWith('"') && !value.startsWith("'")) {
                // Start a new object in the array
                const obj = {};
                obj[inlineObjMatch[1]] = parseYamlValue(inlineObjMatch[2].trim());
                targetCtx[arrayKey].push(obj);
                stack.push({ type: 'array', data: targetCtx[arrayKey], key: arrayKey, indent: lineIndent });
            }
            else {
                // Simple value
                targetCtx[arrayKey].push(parseYamlValue(value));
            }
            continue;
        }
        // Key-value pair
        const kvMatch = trimmed.match(/^(\w[\w-]*):\s*(.*)$/);
        if (kvMatch) {
            currentKey = kvMatch[1];
            const val = kvMatch[2].trim();
            // Check if we're inside an array item (deeper indent than array)
            if (stack.length > 0 && stack[stack.length - 1].type === 'array' && lineIndent > stack[stack.length - 1].indent) {
                const arr = stack[stack.length - 1].data;
                if (arr.length > 0 && typeof arr[arr.length - 1] === 'object') {
                    arr[arr.length - 1][currentKey] = val === '' ? '' : parseYamlValue(val);
                    continue;
                }
            }
            // Handle | literal block scalar
            if (val === '|') {
                // Collect all indented lines until next key or end of frontmatter
                const contentLines = [];
                const keyIndent = lineIndent;
                i++;
                while (i < lines.length) {
                    const nextLine = lines[i];
                    if (nextLine === '---')
                        break;
                    const nextIndent = nextLine.length - nextLine.trimStart().length;
                    // Stop if we hit a line at or less than the key indent that's not empty
                    if (nextLine.trim() !== '' && nextIndent <= keyIndent)
                        break;
                    // Remove the key's indentation from the content
                    if (nextLine.trim() === '') {
                        contentLines.push('');
                    }
                    else if (nextIndent > keyIndent) {
                        contentLines.push(nextLine.slice(keyIndent + 2));
                    }
                    else {
                        contentLines.push(nextLine.trim());
                    }
                    i++;
                }
                // Remove trailing empty lines
                while (contentLines.length > 0 && contentLines[contentLines.length - 1] === '') {
                    contentLines.pop();
                }
                result[currentKey] = contentLines.join('\n');
                i--; // So the main loop processes the next key
                continue;
            }
            if (val === '') {
                // Could be array or object start - peek next line
                const nextLine = lines[i + 1];
                if (nextLine && nextLine.trim().startsWith('-')) {
                    // Array start
                    lastArrayKey = currentKey;
                    result[currentKey] = [];
                }
                else if (nextLine && nextLine.match(/^\s+\w/)) {
                    // Object start
                    result[currentKey] = {};
                    stack.push({ type: 'object', data: result[currentKey], key: currentKey, indent: lineIndent });
                }
                else {
                    result[currentKey] = '';
                }
            }
            else {
                result[currentKey] = parseYamlValue(val);
            }
        }
    }
    return result;
}
/**
 * 解析单个 YAML 值
 */
function parseYamlValue(val) {
    const trimmed = val.trim();
    if (trimmed === 'true')
        return true;
    if (trimmed === 'false')
        return false;
    if (trimmed === 'null' || trimmed === '~')
        return null;
    if (/^-?\d+$/.test(trimmed))
        return parseInt(trimmed, 10);
    if (/^-?\d+\.\d+$/.test(trimmed))
        return parseFloat(trimmed);
    // Handle quoted strings with escape sequences (like Obsidian's parseYaml)
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        const inner = trimmed.slice(1, -1);
        return inner.replace(/\\\\/g, '\x00').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\x00/g, '\\');
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'"))
        return trimmed.slice(1, -1);
    return trimmed;
}
/**
 * 序列化为 YAML frontmatter
 */
function createFrontmatter(data) {
    return `---\n${stringifyYaml(data).trim()}\n---\n\n`;
}
/**
 * 简化 YAML 序列化
 */
function stringifyYaml(obj, indent = 0) {
    const lines = [];
    const prefix = '  '.repeat(indent);
    if (obj === null || obj === undefined) {
        return 'null';
    }
    if (Array.isArray(obj)) {
        if (obj.length === 0)
            return '[]';
        for (const item of obj) {
            if (typeof item === 'object' && item !== null) {
                lines.push(`${prefix}-`);
                lines.push(stringifyYaml(item, indent + 1));
            }
            else {
                lines.push(`${prefix}- ${formatYamlValue(item)}`);
            }
        }
        return lines.join('\n');
    }
    if (typeof obj === 'object') {
        for (const [key, value] of Object.entries(obj)) {
            if (value === undefined)
                continue;
            if (Array.isArray(value)) {
                if (value.length === 0) {
                    lines.push(`${prefix}${key}: []`);
                }
                else {
                    lines.push(`${prefix}${key}:`);
                    lines.push(stringifyYaml(value, indent + 1));
                }
            }
            else if (typeof value === 'object' && value !== null) {
                lines.push(`${prefix}${key}:`);
                lines.push(stringifyYaml(value, indent + 1));
            }
            else {
                lines.push(`${prefix}${key}: ${formatYamlValue(value)}`);
            }
        }
        return lines.join('\n');
    }
    return `${prefix}${formatYamlValue(obj)}`;
}
/**
 * 格式化单个 YAML 值
 */
/**
 * 格式化单个 YAML 值
 */
function formatYamlValue(val) {
    if (val === null || val === undefined)
        return 'null';
    if (typeof val === 'boolean')
        return val ? 'true' : 'false';
    if (typeof val === 'number')
        return String(val);
    if (typeof val === 'string') {
        // Use double-quoted string with \n escapes for multiline content
        // This is the most compatible format across all YAML parsers
        if (/\n/.test(val)) {
            return '"' + val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
        }
        // Need quoting for special values
        if (val === '' ||
            val === 'true' ||
            val === 'false' ||
            val === 'null' ||
            /^\d+$/.test(val) ||
            /^\d+\.\d+$/.test(val) ||
            /[:\-\[\]{}#&*!|>'"%@`]/.test(val) ||
            val.startsWith(' ') ||
            val.endsWith(' ')) {
            return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        }
        return val;
    }
    return String(val);
}
// ============================================================================
// 迁移服务
// ============================================================================
class MigrationService {
    constructor(options) {
        this.logs = [];
        this.stats = {
            avmApps: 0,
            avmVersions: 0,
            avmProjects: 0,
            avmTodos: 0,
            todolistTodos: 0,
            errors: 0,
            warnings: 0,
        };
        this.options = options;
    }
    log(level, message) {
        this.logs.push({ level, message });
        const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
        console.log(`[${prefix}] ${message}`);
        if (level === 'error')
            this.stats.errors++;
        if (level === 'warn')
            this.stats.warnings++;
    }
    isAbsolutePath(path) {
        return (0, path_1.isAbsolute)(path) || /^[A-Za-z]:/.test(path);
    }
    resolvePath(relativeOrAbsolute) {
        if (this.isAbsolutePath(relativeOrAbsolute)) {
            return relativeOrAbsolute;
        }
        return (0, path_1.resolve)(this.options.vault, relativeOrAbsolute);
    }
    ensureDir(dir) {
        if (!(0, fs_1.existsSync)(dir)) {
            (0, fs_1.mkdirSync)(dir, { recursive: true });
        }
    }
    readFile(filePath) {
        try {
            return (0, fs_1.readFileSync)(filePath, 'utf-8');
        }
        catch (e) {
            this.log('warn', `读取文件失败: ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
            return null;
        }
    }
    writeFile(filePath, content) {
        if (this.options.dryRun) {
            this.log('info', `[DRY-RUN] 将写入: ${filePath}`);
            return;
        }
        // Cross-platform: handle both '/' (Unix/Mac) and '\\' (Windows) separators
        const lastSlash = filePath.lastIndexOf('/');
        const lastBackslash = filePath.lastIndexOf('\\');
        const lastSep = Math.max(lastSlash, lastBackslash);
        this.ensureDir(filePath.substring(0, lastSep));
        (0, fs_1.writeFileSync)(filePath, content, 'utf-8');
    }
    listMarkdownFiles(dirPath) {
        const result = [];
        if (!(0, fs_1.existsSync)(dirPath))
            return result;
        try {
            const items = (0, fs_1.readdirSync)(dirPath);
            for (const item of items) {
                if (!item.endsWith('.md'))
                    continue;
                const fullPath = (0, path_1.join)(dirPath, item);
                try {
                    if ((0, fs_1.statSync)(fullPath).isFile()) {
                        const content = (0, fs_1.readFileSync)(fullPath, 'utf-8');
                        result.push({ content, fileName: item, fullPath });
                    }
                }
                catch (e) {
                    this.log('warn', `读取文件失败: ${fullPath}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }
        catch (e) {
            this.log('warn', `读取目录失败: ${dirPath}: ${e instanceof Error ? e.message : String(e)}`);
        }
        return result;
    }
    // ========================================================================
    // 主入口
    // ========================================================================
    async run() {
        this.log('info', '========================================');
        this.log('info', '开始数据迁移...');
        this.log('info', '========================================');
        const oldDataPath = this.resolvePath(this.options.oldData);
        const newDataPath = this.resolvePath(this.options.newData);
        const todolistPath = this.resolvePath(this.options.todolist);
        const timestamp = Date.now();
        this.log('info', `Vault 路径: ${this.options.vault}`);
        this.log('info', `旧数据路径: ${oldDataPath}`);
        this.log('info', `新数据路径: ${newDataPath}`);
        this.log('info', `todolist 路径: ${todolistPath}`);
        this.log('info', `模式: ${this.options.dryRun ? 'DRY-RUN (不写入)' : '正常写入'}`);
        // 检查旧数据是否存在
        const hasOldData = (0, fs_1.existsSync)(oldDataPath);
        const hasTodolist = (0, fs_1.existsSync)(todolistPath);
        if (!hasOldData && !hasTodolist) {
            this.log('error', '未找到任何旧数据源（AVM 数据目录和 todolist tasks.json 都不存在）');
            return false;
        }
        // 1. 备份
        if (!this.options.skipBackup && !this.options.dryRun) {
            await this.backupOriginalData(oldDataPath, todolistPath, newDataPath, timestamp);
        }
        else if (this.options.dryRun) {
            this.log('info', '[DRY-RUN] 跳过备份');
        }
        // 2. 迁移 AVM 实体
        if (hasOldData) {
            await this.migrateAVMEntities(oldDataPath, newDataPath);
            await this.migrateAVMTodos(oldDataPath, newDataPath);
        }
        // 3. 迁移 todolist
        if (hasTodolist) {
            await this.migrateTodolist(todolistPath, newDataPath);
        }
        // 4. 写迁移日志
        await this.writeMigrationLog(newDataPath, timestamp);
        // 5. 自检
        const verified = this.verify();
        if (!verified) {
            this.log('error', '❌ 迁移自检失败，请检查日志');
            return false;
        }
        // 6. 输出统计
        this.printStats();
        this.log('info', '✅ 数据迁移完成');
        return true;
    }
    // ========================================================================
    // 备份
    // ========================================================================
    async backupOriginalData(oldDataPath, todolistPath, newDataPath, timestamp) {
        const backupDir = (0, path_1.join)(newDataPath, `_migration_backup_${timestamp}`);
        this.log('info', `备份旧数据到 ${backupDir}`);
        this.ensureDir(backupDir);
        // 备份 AVM 旧数据
        if ((0, fs_1.existsSync)(oldDataPath)) {
            const avmBackupDir = (0, path_1.join)(backupDir, 'avm');
            this.ensureDir(avmBackupDir);
            this.copyDirectory(oldDataPath, avmBackupDir);
            this.log('info', `AVM 数据已备份到 ${avmBackupDir}`);
        }
        // 备份 todolist
        if ((0, fs_1.existsSync)(todolistPath)) {
            const todolistBackupDir = (0, path_1.join)(backupDir, 'todolist');
            this.ensureDir(todolistBackupDir);
            (0, fs_1.copyFileSync)(todolistPath, (0, path_1.join)(todolistBackupDir, 'tasks.json'));
            this.log('info', `todolist tasks.json 已备份`);
        }
    }
    copyDirectory(src, dest) {
        this.ensureDir(dest);
        const items = (0, fs_1.readdirSync)(src);
        for (const item of items) {
            const srcPath = (0, path_1.join)(src, item);
            const destPath = (0, path_1.join)(dest, item);
            const stat = (0, fs_1.statSync)(srcPath);
            if (stat.isDirectory()) {
                this.copyDirectory(srcPath, destPath);
            }
            else {
                (0, fs_1.copyFileSync)(srcPath, destPath);
            }
        }
    }
    // ========================================================================
    // 迁移 AVM 实体（App / Version / Project）
    // ========================================================================
    async migrateAVMEntities(oldDataPath, newDataPath) {
        this.log('info', '--- 迁移 AVM 实体 ---');
        // 迁移 Apps
        const oldAppsDir = (0, path_1.join)(oldDataPath, 'apps');
        const newAppsDir = (0, path_1.join)(newDataPath, 'apps');
        if ((0, fs_1.existsSync)(oldAppsDir)) {
            const files = this.listMarkdownFiles(oldAppsDir);
            for (const file of files) {
                const fm = parseFrontmatter(file.content);
                if (!fm || !fm.id) {
                    this.log('warn', `跳过无效 App 文件: ${file.fileName}`);
                    continue;
                }
                const app = this.convertApp(fm);
                const fileName = `${sanitizeFileName(app.name)}__${app.id}.md`;
                const filePath = (0, path_1.join)(newAppsDir, fileName);
                this.writeFile(filePath, createFrontmatter(app));
                this.stats.avmApps++;
            }
            this.log("info", `迁移了 ${this.stats.avmApps} 个 App`);
        }
        else {
            this.log('info', '未找到旧 apps 目录，跳过');
        }
        // 迁移 Versions，同时构建 versionId -> appId 映射
        const versionToAppMap = new Map();
        const oldVersionsDir = (0, path_1.join)(oldDataPath, 'versions');
        const newVersionsDir = (0, path_1.join)(newDataPath, 'versions');
        if ((0, fs_1.existsSync)(oldVersionsDir)) {
            const files = this.listMarkdownFiles(oldVersionsDir);
            for (const file of files) {
                const fm = parseFrontmatter(file.content);
                if (!fm || !fm.id) {
                    this.log('warn', `跳过无效 Version 文件: ${file.fileName}`);
                    continue;
                }
                const version = this.convertVersion(fm);
                if (!version)
                    continue;
                // 记录 versionId -> appId 映射
                versionToAppMap.set(version.id, version.appId);
                // 获取 appName（从文件名或 frontmatter）
                const appName = this.inferAppNameFromFile(file.fileName, fm);
                const fileName = `${sanitizeFileName(appName)}_${sanitizeFileName(version.versionNumber)}__${version.id}.md`;
                const filePath = (0, path_1.join)(newVersionsDir, fileName);
                this.writeFile(filePath, createFrontmatter(version));
                this.stats.avmVersions++;
            }
            this.log("info", `迁移了 ${this.stats.avmVersions} 个 Version`);
        }
        else {
            this.log('info', '未找到旧 versions 目录，跳过');
        }
        // 迁移 Projects（排除 todos__*.md）
        const oldProjectsDir = (0, path_1.join)(oldDataPath, 'projects');
        const newProjectsDir = (0, path_1.join)(newDataPath, 'projects');
        if ((0, fs_1.existsSync)(oldProjectsDir)) {
            const files = this.listMarkdownFiles(oldProjectsDir);
            for (const file of files) {
                // 跳过 todos__*.md（待办单独处理）
                if (file.fileName.startsWith('todos__'))
                    continue;
                const fm = parseFrontmatter(file.content);
                if (!fm || !fm.id) {
                    this.log('warn', `跳过无效 Project 文件: ${file.fileName}`);
                    continue;
                }
                const project = this.convertProject(fm, versionToAppMap);
                const fileName = `${sanitizeFileName(project.name)}__${project.id}.md`;
                const filePath = (0, path_1.join)(newProjectsDir, fileName);
                this.writeFile(filePath, createFrontmatter(this.projectToFrontmatter(project)));
                this.stats.avmProjects++;
            }
            this.log("info", `迁移了 ${this.stats.avmProjects} 个 Project`);
        }
        else {
            this.log('info', '未找到旧 projects 目录，跳过');
        }
    }
    // ========================================================================
    // 迁移 AVM 待办
    // ========================================================================
    async migrateAVMTodos(oldDataPath, newDataPath) {
        this.log('info', '--- 迁移 AVM 待办 ---');
        const oldProjectsDir = (0, path_1.join)(oldDataPath, 'projects');
        const newTodosDir = (0, path_1.join)(newDataPath, 'todos');
        if (!(0, fs_1.existsSync)(oldProjectsDir))
            return;
        const files = this.listMarkdownFiles(oldProjectsDir);
        for (const file of files) {
            if (!file.fileName.startsWith('todos__'))
                continue;
            // 从文件名提取 projectId: todos__{projectId}.md
            const projectIdMatch = file.fileName.match(/^todos__(.+)\.md$/i);
            const projectId = projectIdMatch ? projectIdMatch[1] : null;
            const fm = parseFrontmatter(file.content);
            if (!fm) {
                this.log('warn', `无法解析待办文件: ${file.fileName}`);
                continue;
            }
            // todos 数组在 frontmatter 中
            const todosRaw = fm.todos;
            if (!Array.isArray(todosRaw)) {
                this.log('warn', `待办文件中无 todos 数组: ${file.fileName}`);
                continue;
            }
            for (const todoRaw of todosRaw) {
                if (typeof todoRaw !== 'object' || todoRaw === null)
                    continue;
                const todoFm = todoRaw;
                const todo = this.convertAVMTodo(todoFm, projectId);
                const fileName = `${sanitizeFileName((todo.content || 'untitled').slice(0, 20))}__${todo.id}.md`;
                const filePath = (0, path_1.join)(newTodosDir, fileName);
                this.writeFile(filePath, createFrontmatter(todo));
                this.stats.avmTodos++;
            }
        }
        this.log("info", `迁移了 ${this.stats.avmTodos} 条 AVM 待办`);
    }
    // ========================================================================
    // 迁移 todolist tasks.json
    // ========================================================================
    async migrateTodolist(todolistPath, newDataPath) {
        this.log('info', '--- 迁移 todolist tasks.json ---');
        const newTodosDir = (0, path_1.join)(newDataPath, 'todos');
        const content = this.readFile(todolistPath);
        if (!content)
            return;
        let data;
        try {
            data = JSON.parse(content);
        }
        catch (e) {
            this.log('error', `解析 tasks.json 失败: ${e instanceof Error ? e.message : String(e)}`);
            return;
        }
        if (!data.tasks || !Array.isArray(data.tasks)) {
            this.log('warn', 'tasks.json 中无 tasks 数组');
            return;
        }
        for (const dayGroup of data.tasks) {
            if (!dayGroup.tasksList || !Array.isArray(dayGroup.tasksList))
                continue;
            for (const task of dayGroup.tasksList) {
                if (!task || !task.content)
                    continue;
                const todo = this.convertTodolistTask(task);
                const fileName = `${sanitizeFileName((todo.content || 'untitled').slice(0, 20))}__${todo.id}.md`;
                const filePath = (0, path_1.join)(newTodosDir, fileName);
                this.writeFile(filePath, createFrontmatter(todo));
                this.stats.todolistTodos++;
            }
        }
        this.log("info", `迁移了 ${this.stats.todolistTodos} 条 todolist 待办`);
    }
    // ========================================================================
    // 转换函数
    // ========================================================================
    convertApp(fm) {
        return {
            id: String(fm.id || generateId()),
            name: String(fm.name || '未命名'),
            createdAt: toISO(fm.createdAt),
            updatedAt: toISO(fm.updatedAt || fm.createdAt),
            version: typeof fm.version === 'number' ? fm.version : 1,
        };
    }
    convertVersion(fm) {
        if (!fm.id || !fm.appId)
            return null;
        return {
            id: String(fm.id),
            appId: String(fm.appId),
            versionNumber: String(fm.versionNumber || ''),
            bllVersion: String(fm.bllVersion || ''),
            ippVersion: String(fm.ippVersion || ''),
            webVersion: String(fm.webVersion || ''),
            updateContent: String(fm.updateContent || ''),
            isArchived: fm.isArchived === true,
            createdAt: toISO(fm.createdAt),
            updatedAt: toISO(fm.updatedAt || fm.createdAt),
            version: typeof fm.version === 'number' ? fm.version : 1,
        };
    }
    convertProject(fm, versionToAppMap) {
        // 解析 progressHistory
        const progressHistory = [];
        if (Array.isArray(fm.progressHistory)) {
            for (const item of fm.progressHistory) {
                if (typeof item === 'string') {
                    const at = item.lastIndexOf('@');
                    if (at > 0) {
                        progressHistory.push({
                            progress: item.slice(0, at),
                            changedAt: toISO(item.slice(at + 1)),
                        });
                    }
                }
                else if (typeof item === 'object' && item !== null) {
                    const obj = item;
                    if (typeof obj.progress === 'string' && typeof obj.changedAt === 'string') {
                        progressHistory.push({
                            progress: obj.progress,
                            changedAt: toISO(obj.changedAt),
                        });
                    }
                }
            }
        }
        // 解析 appVersionLinks（新格式）或 versionId（旧格式）
        const appVersionLinks = [];
        if (Array.isArray(fm.appVersionLinks)) {
            for (const link of fm.appVersionLinks) {
                if (typeof link === 'object' && link !== null) {
                    const obj = link;
                    if (typeof obj.appId === 'string' && typeof obj.versionId === 'string') {
                        appVersionLinks.push({ appId: obj.appId, versionId: obj.versionId });
                    }
                }
            }
        }
        else if (typeof fm.versionId === 'string' && fm.versionId) {
            // 旧格式：只有 versionId，需要通过 version 查找 appId
            const vid = fm.versionId;
            const appId = versionToAppMap?.get(vid) || '';
            appVersionLinks.push({ appId, versionId: vid });
        }
        // 解析 projectInfo
        const projectInfo = [];
        if (Array.isArray(fm.projectInfo)) {
            for (const item of fm.projectInfo) {
                if (typeof item === 'object' && item !== null) {
                    const obj = item;
                    if (typeof obj.description === 'string' && obj.description.trim()) {
                        projectInfo.push({
                            description: obj.description,
                            link: typeof obj.link === 'string' ? obj.link : '',
                        });
                    }
                }
            }
        }
        return {
            id: String(fm.id || generateId()),
            name: String(fm.name || '未命名项目'),
            appVersionLinks,
            manager: String(fm.manager || ''),
            responsiblePerson: String(fm.responsiblePerson || ''),
            projectLink: String(fm.projectLink || ''),
            componentLink: String(fm.componentLink || ''),
            features: String(fm.features || ''),
            spec: String(fm.spec || ''),
            requirements: String(fm.requirements || ''),
            progress: String(fm.progress || ''),
            progressHistory,
            b1IntegrationTestTime: this.normalizeDate(fm.b1IntegrationTestTime),
            b1SystemTestTime: this.normalizeDate(fm.b1SystemTestTime),
            b2IntegrationTestTime: this.normalizeDate(fm.b2IntegrationTestTime),
            b2SystemTestTime: this.normalizeDate(fm.b2SystemTestTime),
            b3IntegrationTestTime: this.normalizeDate(fm.b3IntegrationTestTime),
            b3SystemTestTime: this.normalizeDate(fm.b3SystemTestTime),
            b4IntegrationTestTime: this.normalizeDate(fm.b4IntegrationTestTime),
            b4SystemTestTime: this.normalizeDate(fm.b4SystemTestTime),
            actualReleaseTime: this.normalizeDate(fm.actualReleaseTime),
            projectInfo,
            createdAt: toISO(fm.createdAt),
            updatedAt: toISO(fm.updatedAt || fm.createdAt),
            version: typeof fm.version === 'number' ? fm.version : 1,
        };
    }
    projectToFrontmatter(project) {
        return {
            ...project,
            responsiblePerson: project.responsiblePerson || '',
            progressHistory: project.progressHistory.map((h) => `${h.progress}@${h.changedAt}`),
            appVersionLinks: project.appVersionLinks,
        };
    }
    convertAVMTodo(fm, projectId) {
        const id = String(fm.id || generateId());
        const content = String(fm.content || '');
        const completed = fm.completed === true || fm.status === 'done';
        const createdAt = toISO(fm.createdAt || fm.createAt);
        return {
            id,
            content,
            link: String(fm.link || ''),
            dueDate: this.normalizeDate(fm.dueDate),
            priority: this.normalizePriority(fm.priority),
            status: completed ? 'done' : 'todo',
            pinned: fm.pinned === true,
            categoryId: null,
            projectId,
            responsiblePerson: String(fm.responsiblePerson || ''),
            completedAt: completed ? (fm.completedAt ? toISO(fm.completedAt) : createdAt) : '',
            createdAt,
            updatedAt: toISO(fm.updatedAt || fm.createdAt || fm.createAt),
            version: typeof fm.version === 'number' ? fm.version : 1,
        };
    }
    convertTodolistTask(task) {
        const id = String(task.taskId || generateId());
        const content = String(task.content || '');
        const completed = task.completed === true;
        const createdAt = toISO(task.createAt || task.createTime);
        return {
            id,
            content,
            link: String(task.link || ''),
            dueDate: this.normalizeDate(task.dueDate),
            priority: this.normalizePriority(task.priority),
            status: completed ? 'done' : 'todo',
            pinned: false,
            categoryId: null,
            projectId: null,
            responsiblePerson: '',
            completedAt: completed ? createdAt : '',
            createdAt,
            updatedAt: createdAt,
            version: 1,
        };
    }
    // ========================================================================
    // 辅助函数
    // ========================================================================
    normalizePriority(p) {
        if (p === 'high' || p === 'medium' || p === 'low')
            return p;
        return '';
    }
    normalizeDate(val) {
        if (val === null || val === undefined || val === '')
            return '';
        const str = String(val).trim();
        if (str === '')
            return '';
        // 验证 YYYY-MM-DD 格式
        if (/^\d{4}-\d{2}-\d{2}$/.test(str))
            return str;
        // 尝试解析其他日期格式
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = (d.getMonth() + 1).toString().padStart(2, '0');
            const day = d.getDate().toString().padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
        return '';
    }
    inferAppNameFromFile(fileName, fm) {
        // 尝试从 frontmatter 获取 appName
        if (fm.appName && typeof fm.appName === 'string')
            return fm.appName;
        // 尝试从文件名推断：{appName}_{versionNum}__{id}.md
        const match = fileName.match(/^(.+?)_.*?__[a-f0-9-]+\.md$/i);
        if (match)
            return match[1];
        return 'unknown';
    }
    // ========================================================================
    // 日志与自检
    // ========================================================================
    async writeMigrationLog(newDataPath, timestamp) {
        const logPath = (0, path_1.join)(newDataPath, `_migration_${timestamp}.log`);
        const header = `迁移时间: ${new Date().toISOString()}\n模式: ${this.options.dryRun ? 'DRY-RUN' : '正常'}\n\n`;
        const logContent = header + this.logs.map((l) => `[${l.level.toUpperCase()}] ${l.message}`).join('\n');
        this.writeFile(logPath, logContent);
    }
    verify() {
        this.log('info', '--- 自检 ---');
        const totalTodos = this.stats.avmTodos + this.stats.todolistTodos;
        this.log('info', `统计: ${this.stats.avmApps} apps, ${this.stats.avmVersions} versions, ${this.stats.avmProjects} projects, ${totalTodos} todos`);
        if (this.stats.errors > 0) {
            this.log('error', `发现 ${this.stats.errors} 个错误`);
            return false;
        }
        if (this.stats.warnings > 0) {
            this.log('warn', `发现 ${this.stats.warnings} 个警告（非致命）`);
        }
        return true;
    }
    printStats() {
        this.log('info', '========================================');
        this.log('info', '迁移统计:');
        this.log('info', `  AVM Apps:      ${this.stats.avmApps}`);
        this.log('info', `  AVM Versions:  ${this.stats.avmVersions}`);
        this.log('info', `  AVM Projects:  ${this.stats.avmProjects}`);
        this.log('info', `  AVM Todos:     ${this.stats.avmTodos}`);
        this.log('info', `  Todolist Todos: ${this.stats.todolistTodos}`);
        this.log('info', `  错误:          ${this.stats.errors}`);
        this.log('info', `  警告:          ${this.stats.warnings}`);
        this.log('info', '========================================');
    }
}
// ============================================================================
// CLI 入口
// ============================================================================
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        vault: process.cwd(),
        oldData: 'app-version-manager',
        newData: 'workflow-hub',
        todolist: '.obsidian/plugins/todolist/tasks.json',
        dryRun: false,
        skipBackup: false,
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--vault':
                options.vault = args[++i];
                break;
            case '--old-data':
                options.oldData = args[++i];
                break;
            case '--new-data':
                options.newData = args[++i];
                break;
            case '--todolist':
                options.todolist = args[++i];
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--skip-backup':
                options.skipBackup = true;
                break;
            case '--help':
                printHelp();
                process.exit(0);
                break;
            default:
                console.error(`未知参数: ${args[i]}`);
                printHelp();
                process.exit(1);
        }
    }
    return options;
}
function printHelp() {
    console.log(`
obsidian-workflow-hub 数据迁移脚本

用法：
  npx ts-node scripts/migrate.ts [选项]

选项：
  --vault <path>        Obsidian vault 路径（默认当前目录）
  --old-data <path>     旧 AVM 数据路径（相对 vault 或绝对路径，默认 app-version-manager）
  --new-data <path>     新数据路径（相对 vault 或绝对路径，默认 workflow-hub）
  --todolist <path>     todolist tasks.json 路径（默认 .obsidian/plugins/todolist/tasks.json）
  --dry-run             仅预览，不写入任何文件
  --skip-backup         跳过备份步骤
  --help                显示帮助

示例：
  npx ts-node scripts/migrate.ts --vault ~/ObsidianVault
  npx ts-node scripts/migrate.ts --vault ~/ObsidianVault --dry-run
  npx ts-node scripts/migrate.ts --vault ~/ObsidianVault --old-data /path/to/old --new-data /path/to/new
`);
}
// ============================================================================
// 主程序
// ============================================================================
async function main() {
    const options = parseArgs();
    const service = new MigrationService(options);
    const success = await service.run();
    process.exit(success ? 0 : 1);
}
main().catch((e) => {
    console.error('迁移脚本异常:', e);
    process.exit(1);
});
