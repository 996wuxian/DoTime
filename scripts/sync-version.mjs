import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relPath) {
  return JSON.parse(readFileSync(resolve(root, relPath), "utf8"));
}

function writeJson(relPath, value) {
  writeFileSync(resolve(root, relPath), JSON.stringify(value, null, 2) + "\n", "utf8");
}

const pkg = readJson("package.json");
const { version } = pkg;

if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`[sync-version] package.json 中的 version 无效: ${JSON.stringify(version)}`);
  process.exit(1);
}

// 1. Tauri 打包/安装包版本
const tauriPath = "src-tauri/tauri.conf.json";
const tauri = readJson(tauriPath);
if (tauri.version !== version) {
  const oldVersion = tauri.version;
  tauri.version = version;
  writeJson(tauriPath, tauri);
  console.log(`[sync-version] ${tauriPath}: ${oldVersion} -> ${version}`);
}

// 2. npm 锁文件（npm version 会自己同步，这里兜底）
const lockPath = "package-lock.json";
const lock = readJson(lockPath);
let lockChanged = false;
if (lock.version !== version) {
  lock.version = version;
  lockChanged = true;
}
if (lock.packages?.[""] && lock.packages[""].version !== version) {
  lock.packages[""].version = version;
  lockChanged = true;
}
if (lockChanged) {
  writeJson(lockPath, lock);
  console.log(`[sync-version] ${lockPath}: 已同步到 ${version}`);
}

// 3. Rust crate 版本（只改 [package] 段，不碰依赖版本）
const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(resolve(root, cargoPath), "utf8");
const eol = cargo.includes("\r\n") ? "\r\n" : "\n";
const lines = cargo.split(/\r?\n/);
let inPackage = false;
let cargoChanged = false;

for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  if (/^\[[^\]]+\]$/.test(trimmed)) {
    inPackage = trimmed === "[package]";
    continue;
  }
  if (inPackage && /^version\s*=\s*"[^"]*"\s*$/.test(trimmed)) {
    const updated = lines[i].replace(/"[^"]*"/, `"${version}"`);
    if (updated !== lines[i]) {
      lines[i] = updated;
      cargoChanged = true;
    }
    break;
  }
}

if (cargoChanged) {
  writeFileSync(resolve(root, cargoPath), lines.join(eol), "utf8");
  console.log(`[sync-version] ${cargoPath}: 已同步到 ${version}`);
}

console.log(`[sync-version] 完成，当前版本 ${version}`);
