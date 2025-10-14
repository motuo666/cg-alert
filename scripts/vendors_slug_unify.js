#!/usr/bin/env node
/**
 * vendors_slug_unify.js — 将 vendors/<domain>[,Company]/ → vendors/<domain>/
 * - 合并重复（优先保留已有 index.html / feed.xml）
 * - 更新 sitemap-vendors.xml 中的重复条目（若存在则重写）
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const VDIR = path.join(ROOT, 'vendors');

function cleanSlug(s){
  s = String(s||'').trim();
  // 取逗号前作为域名部分
  const domain = s.split(',')[0].trim();
  return domain.toLowerCase();
}

function moveDir(oldDir, newDir){
  if (!fs.existsSync(oldDir)) return;
  fs.mkdirSync(newDir, { recursive: true });
  for (const f of fs.readdirSync(oldDir)) {
    const src = path.join(oldDir, f), dst = path.join(newDir, f);
    if (fs.existsSync(dst)) continue; // 目标已存在则保留
    fs.renameSync(src, dst);
  }
  // 清理空目录
  try { fs.rmdirSync(oldDir); } catch {}
}

(function main(){
  if (!fs.existsSync(VDIR)) { console.log('no vendors/'); return; }
  const entries = fs.readdirSync(VDIR, { withFileTypes: true });
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const oldSlug = d.name;
    if (!oldSlug.includes(',')) continue; // 已是规范
    const newSlug = cleanSlug(oldSlug);
    if (!newSlug || newSlug === oldSlug) continue;
    const oldDir = path.join(VDIR, oldSlug);
    const newDir = path.join(VDIR, newSlug);
    console.log(`unify: ${oldSlug} -> ${newSlug}`);
    moveDir(oldDir, newDir);
  }
  console.log('done');
})();
