// 版本号同步脚本：读取 manifest.json 的 version，写入 versions.json（Obsidian 插件发布用）
import { readFileSync, writeFileSync, existsSync } from 'fs';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf-8'));
const version = manifest.version;
const minAppVersion = manifest.minAppVersion;

let versions = {};
if (existsSync('versions.json')) {
  try {
    versions = JSON.parse(readFileSync('versions.json', 'utf-8'));
  } catch {
    versions = {};
  }
}

versions[version] = minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');
console.log(`versions.json 已更新: ${version} -> ${minAppVersion}`);
