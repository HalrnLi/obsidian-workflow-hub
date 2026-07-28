#!/usr/bin/env node
/**
 * ============================================================================
 *  综合测试：数据迁移脚本验证
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VAULT_PATH = path.resolve(__dirname, 'test-fixture/comprehensive-vault');
const NEW_DATA_PATH = path.join(VAULT_PATH, 'workflow-hub');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; errors.push(message); console.log(`  ❌ ${message}`); }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) { passed++; console.log(`  ✅ ${message}`); }
  else {
    failed++;
    errors.push(`${message}\n     期望: ${JSON.stringify(expected)}\n     实际: ${JSON.stringify(actual)}`);
    console.log(`  ❌ ${message}`);
    console.log(`     期望: ${JSON.stringify(expected)}`);
    console.log(`     实际: ${JSON.stringify(actual)}`);
  }
}

function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

// Extract a field value from frontmatter content (supports | block scalar and quoted strings)
function getField(content, fieldName) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(new RegExp(`^${fieldName}:\\s*(.*)$`));
    if (match) {
      let val = match[1];
      
      // Check if it's a | literal block scalar
      if (val === '|') {
        // Collect all indented lines until next key or end of frontmatter
        let result = '';
        i++;
        while (i < lines.length) {
          const nextLine = lines[i];
          // Stop at end of frontmatter or next key
          if (nextLine === '---' || (nextLine.match(/^\w[\w-]*:/) && !nextLine.startsWith('  '))) break;
          // Remove the 2-space indentation
          if (nextLine.startsWith('  ')) {
            result += nextLine.slice(2) + '\n';
          } else if (nextLine.trim() === '') {
            result += '\n';
          } else {
            break;
          }
          i++;
        }
        // Remove trailing newline
        if (result.endsWith('\n')) result = result.slice(0, -1);
        return result;
      }
      
      // Check if it's a quoted multiline string
      if (val.startsWith('"')) {
        let result = '';
        let inStr = true;
        let escaped = false;
        for (let j = 1; j < val.length; j++) {
          const ch = val[j];
          if (escaped) { result += ch; escaped = false; continue; }
          if (ch === '\\') { escaped = true; continue; }
          if (ch === '"') { inStr = false; break; }
          result += ch;
        }
        if (!inStr) return result;
        i++;
        while (i < lines.length) {
          const nextLine = lines[i];
          for (let j = 0; j < nextLine.length; j++) {
            const ch = nextLine[j];
            if (escaped) { result += ch; escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (ch === '"') return result;
            result += ch;
          }
          result += '\n';
          i++;
        }
        return result;
      }
      
      // Single-quoted
      if (val.startsWith("'") && val.endsWith("'") && val.length >= 2) {
        return val.slice(1, -1);
      }
      // Simple value
      return val;
    }
  }
  return undefined;
}

// Extract array of objects from frontmatter
function getArray(content, arrayName) {
  const lines = content.split('\n');
  const result = [];
  let inArray = false;
  let arrayKeyIndent = -1;
  let dashIndent = -1;
  let currentObj = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const indent = line.length - line.trimStart().length;
    
    // Detect array start
    if (trimmed === arrayName + ':') {
      inArray = true;
      arrayKeyIndent = indent;
      continue;
    }
    
    if (!inArray) continue;
    
    // Detect array item (line starting with -)
    if (trimmed.startsWith('-')) {
      dashIndent = indent;
      if (currentObj) result.push(currentObj);
      currentObj = {};
      
      // Check for inline content after -
      const afterDash = trimmed.slice(1).trim();
      if (afterDash) {
        // Could be inline object: - key: value
        const inlineMatch = afterDash.match(/^(\w[\w-]*):\s*(.*)$/);
        if (inlineMatch && !afterDash.startsWith('"') && !afterDash.startsWith("'")) {
          currentObj[inlineMatch[1]] = inlineMatch[2].trim();
        } else {
          // Simple value
          currentObj._value = afterDash;
        }
      }
      continue;
    }
    
    // If we're in an array and see a property of the current object
    if (currentObj && indent > dashIndent) {
      const propMatch = trimmed.match(/^(\w[\w-]*):\s*(.*)$/);
      if (propMatch) {
        let val = propMatch[2].trim();
        // Strip surrounding quotes
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        currentObj[propMatch[1]] = val;
        continue;
      }
    }
    
    // If we see a line at or below the array key indent, we've exited
    if (trimmed !== '' && indent <= arrayKeyIndent && !trimmed.startsWith('-')) {
      break;
    }
    
    // If we see a new key at the same level as array items, check if it's a new item
    if (currentObj && indent === dashIndent && !trimmed.startsWith('-')) {
      break;
    }
  }
  
  if (currentObj) result.push(currentObj);
  return result;
}

// ============================================================================
console.log('========================================');
console.log('开始综合测试...');
console.log('========================================\n');

if (fs.existsSync(NEW_DATA_PATH)) {
  fs.rmSync(NEW_DATA_PATH, { recursive: true, force: true });
}

console.log('--- 执行迁移 ---');
try {
  execSync(`node ${path.join(__dirname, 'migrate.js')} --vault ${VAULT_PATH} --skip-backup`, {
    encoding: 'utf-8', cwd: __dirname
  });
} catch (e) {
  console.error('迁移失败:', e.message);
  process.exit(1);
}

// ============================================================================
const appFiles = fs.readdirSync(path.join(NEW_DATA_PATH, 'apps'));
const versionFiles = fs.readdirSync(path.join(NEW_DATA_PATH, 'versions'));
const projFiles = fs.readdirSync(path.join(NEW_DATA_PATH, 'projects'));
const todoFiles = fs.readdirSync(path.join(NEW_DATA_PATH, 'todos'));

const specialAppFile = appFiles.find(f => f.includes('app001'));
const ver001File = versionFiles.find(f => f.includes('ver001'));
const proj001File = projFiles.find(f => f.includes('proj001'));
const proj002File = projFiles.find(f => f.includes('proj002'));
const proj003File = projFiles.find(f => f.includes('proj003'));

// Test 1: Apps
console.log('\n--- 测试 1: Apps ---');
assertEqual(appFiles.length, 2, 'App总数=2');
if (specialAppFile) {
  const c = readFile(path.join(NEW_DATA_PATH, 'apps', specialAppFile));
  assertEqual(getField(c, 'name'), "特殊App & 测试 <script>", 'App名特殊字符');
  assertEqual(getField(c, 'createdAt'), '2024-01-01T00:00:00.000Z', '毫秒→ISO');
}

// Test 2: Versions
console.log('\n--- 测试 2: Versions ---');
assertEqual(versionFiles.length, 3, 'Version总数=3');
if (ver001File) {
  const c = readFile(path.join(NEW_DATA_PATH, 'versions', ver001File));
  assertEqual(getField(c, 'appId'), 'app001-0000-0000-0000-000000000001', 'appId');
  assertEqual(getField(c, 'bllVersion'), '2.0.0-beta+build.123', 'bllVersion');
  const uc = getField(c, 'updateContent');
  assert(typeof uc === 'string' && uc.includes('修复bug'), 'updateContent多行');
}

// Test 3: Projects（特殊字符 + 多行）
console.log('\n--- 测试 3: Projects（特殊字符 + 多行）---');
if (proj001File) {
  const c = readFile(path.join(NEW_DATA_PATH, 'projects', proj001File));
  const name = getField(c, 'name');
  assert(name && name.includes('<tag>'), 'HTML标签');
  assert(name && name.includes('&'), '&符号');
  assert(name && name.includes('"double"'), '双引号');
  
  const features = getField(c, 'features');
  assert(typeof features === 'string' && features.includes('HTML标签'), 'features多行');
  assert(typeof features === 'string' && features.includes('🎉'), 'features emoji');
  
  const req = getField(c, 'requirements');
  assert(typeof req === 'string' && req.includes('需求1'), 'requirements多行');
  assert(typeof req === 'string' && req.includes('子需求3.1'), 'requirements缩进子项');
  
  const links = getArray(c, 'appVersionLinks');
  assert(Array.isArray(links) && links.length >= 1, 'appVersionLinks非空');
  if (links.length >= 1) {
    assertEqual(links[0].appId, 'app001-0000-0000-0000-000000000001', 'appId补全');
    assertEqual(links[0].versionId, 'ver001-0000-0000-0000-000000000001', 'versionId');
  }
  
  const info = getArray(c, 'projectInfo');
  assertEqual(info.length, 3, 'projectInfo=3');
  
  assertEqual(getField(c, 'b1IntegrationTestTime'), '2026-02-10', '日期不转ISO');
}

// Test 4: Projects（空字段）
console.log('\n--- 测试 4: Projects（空字段）---');
if (proj002File) {
  const c = readFile(path.join(NEW_DATA_PATH, 'projects', proj002File));
  assertEqual(getField(c, 'name'), '空字段项目', '名称');
  assertEqual(getField(c, 'manager'), '', '空manager');
  
  const history = getArray(c, 'progressHistory');
  assertEqual(history.length, 0, '空progressHistory');
  
  const info = getArray(c, 'projectInfo');
  assertEqual(info.length, 0, '空projectInfo');
}

// Test 5: Projects（多版本）
console.log('\n--- 测试 5: Projects（多版本）---');
if (proj003File) {
  const c = readFile(path.join(NEW_DATA_PATH, 'projects', proj003File));
  const links = getArray(c, 'appVersionLinks');
  assertEqual(links.length, 3, '3个版本关联');
}

// Test 6: AVM Todos
console.log('\n--- 测试 6: AVM Todos ---');
const avmTodos = todoFiles.filter(f => f.includes('avt'));
assertEqual(avmTodos.length, 4, 'AVM待办=4');

// Test 7: Todolist
console.log('\n--- 测试 7: Todolist ---');
const tdlTodos = todoFiles.filter(f => f.includes('tdl'));
assertEqual(tdlTodos.length, 7, 'Todolist=7');

const tdl001 = todoFiles.find(f => f.includes('tdl001'));
if (tdl001) {
  const c = readFile(path.join(NEW_DATA_PATH, 'todos', tdl001));
  assert(getField(c, 'content').includes('#工作'), '#tag');
  const pid = getField(c, 'projectId');
  assert(pid === null || pid === 'null' || pid === '', 'projectId=null');
}

// Test 8: 时间格式
console.log('\n--- 测试 8: 时间格式 ---');
if (specialAppFile) {
  const c = readFile(path.join(NEW_DATA_PATH, 'apps', specialAppFile));
  assertEqual(getField(c, 'createdAt'), '2024-01-01T00:00:00.000Z', '毫秒→ISO');
}

// Test 9: 文件命名
console.log('\n--- 测试 9: 文件命名 ---');
const allFiles = [...appFiles, ...versionFiles, ...projFiles, ...todoFiles];
assert(allFiles.every(f => f.includes('__')), '所有文件含__');

// Test 10: 备份
console.log('\n--- 测试 10: 备份 ---');
try { execSync(`node ${path.join(__dirname, 'migrate.js')} --vault ${VAULT_PATH}`, { encoding: 'utf-8', cwd: __dirname }); } catch {}
const backups = fs.readdirSync(NEW_DATA_PATH).filter(f => f.startsWith('_migration_backup_'));
assert(backups.length > 0, '备份创建');

// ============================================================================
// 最终汇总（必须放在所有测试之后）

// ============================================================================
// 测试 11: 数据编辑后重新迁移
// ============================================================================
console.log('\n--- 测试 11: 数据编辑后重新迁移 ---');

// 修改一个已迁移的文件
const editFile = path.join(NEW_DATA_PATH, 'projects', proj001File);
let editContent = readFile(editFile);
const originalName = getField(editContent, 'name');
// 修改名称
editContent = editContent.replace(`name: "${originalName}"`, `name: "${originalName} [已编辑]"`);
fs.writeFileSync(editFile, editContent);

// 重新迁移
try { execSync(`node ${path.join(__dirname, 'migrate.js')} --vault ${VAULT_PATH} --skip-backup`, { encoding: 'utf-8', cwd: __dirname }); } catch {}

// 检查：重新迁移后，旧数据会覆盖编辑的数据（因为迁移总是从源读取）
const reEditedContent = readFile(editFile);
const newName = getField(reEditedContent, 'name');
// 迁移会从源重新生成，所以编辑会被覆盖回原始值
assert(newName === originalName, '重新迁移覆盖编辑（幂等性）');

// ============================================================================
// 测试 12: 数据显示（Round-trip 验证）
// ============================================================================
console.log('\n--- 测试 12: Round-trip 数据一致性 ---');

// 验证迁移后的数据能被正确解析
if (proj001File) {
  const c = readFile(path.join(NEW_DATA_PATH, 'projects', proj001File));
  
  // 验证所有关键字段都存在且非空
  assert(getField(c, 'id') !== undefined, 'id字段存在');
  assert(getField(c, 'name') !== undefined, 'name字段存在');
  assert(getField(c, 'createdAt') !== undefined, 'createdAt字段存在');
  assert(getField(c, 'version') !== undefined, 'version字段存在');
  
  // 验证时间格式正确
  const created = getField(c, 'createdAt');
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(created), 'createdAt是ISO格式');
  
  // 验证日期字段不被转换
  const b1 = getField(c, 'b1IntegrationTestTime');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(b1), '日期字段是YYYY-MM-DD格式');
}

// 验证Todo的round-trip
const avt001File = todoFiles.find(f => f.includes('avt001'));
if (avt001File) {
  const c = readFile(path.join(NEW_DATA_PATH, 'todos', avt001File));
  assert(getField(c, 'id') !== undefined, 'Todo id存在');
  assert(getField(c, 'content') !== undefined, 'Todo content存在');
  assert(getField(c, 'status') === 'todo' || getField(c, 'status') === 'done', 'status有效');
  assert(['high', 'medium', 'low', ''].includes(getField(c, 'priority')), 'priority有效');
}


// ============================================================================
// 测试 13: 边界情况
// ============================================================================
console.log('\n--- 测试 13: 边界情况 ---');

// 空todos数组不创建文件
const emptyTodoFiles = todoFiles.filter(f => f.includes('proj002'));
assertEqual(emptyTodoFiles.length, 0, '空todos不创建文件');

// 特殊文件名（sanitize后）
const specialNameApps = fs.readdirSync(path.join(NEW_DATA_PATH, 'apps')).filter(f => f.includes('特殊'));
assert(specialNameApps.length > 0, '特殊文件名正确处理');

// 验证所有todo文件都有正确的frontmatter
for (const todoFile of todoFiles) {
  const c = readFile(path.join(NEW_DATA_PATH, 'todos', todoFile));
  assert(getField(c, 'id') !== undefined, `${todoFile} 有id`);
  assert(getField(c, 'content') !== undefined, `${todoFile} 有content`);
  assert(['todo', 'done'].includes(getField(c, 'status')), `${todoFile} status有效`);
}

// ============================================================================
// 测试 14: 数据编辑后验证
// ============================================================================
console.log('\n--- 测试 14: 数据编辑后验证 ---');

// 模拟用户编辑：修改一个todo的内容
const editTodoFile = todoFiles.find(f => f.includes('avt001'));
if (editTodoFile) {
  const todoPath = path.join(NEW_DATA_PATH, 'todos', editTodoFile);
  let todoContent = readFile(todoPath);
  // 修改内容
  todoContent = todoContent.replace(
    /content:.*$/m,
    'content: "修改后的内容 [用户编辑]"'
  );
  fs.writeFileSync(todoPath, todoContent);
  
  // 验证编辑后的文件可以被正确读取
  const edited = readFile(todoPath);
  const newContent = getField(edited, 'content');
  assert(newContent && newContent.includes('修改后的内容'), '用户编辑内容保留');
  
  // 验证其他字段不受影响
  assert(getField(edited, 'id') !== undefined, '编辑后id仍存在');
  assert(getField(edited, 'status') === 'todo', '编辑后status不变');
}

// ============================================================================
// 测试 15: 特殊输入验证
// ============================================================================
console.log('\n--- 测试 15: 特殊输入验证 ---');

// 验证包含各种特殊字符的字段
if (proj001File) {
  const c = readFile(path.join(NEW_DATA_PATH, 'projects', proj001File));
  
  // 验证projectLink包含&符号的URL
  const projectLink = getField(c, 'projectLink');
  assert(projectLink && projectLink.includes('&'), 'URL中的&保留');
  
  // 验证componentLink包含#符号
  const componentLink = getField(c, 'componentLink');
  assert(componentLink && componentLink.includes('#'), 'URL中的#保留');
  
  // 验证responsiblePerson包含&符号
  const rp = getField(c, 'responsiblePerson');
  assert(rp && rp.includes('&'), '负责人中的&保留');
}

// ============================================================================
// 最终汇总
// ============================================================================
console.log('\n========================================');
console.log(`测试结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  console.log('\n失败详情:');
  errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
}
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
