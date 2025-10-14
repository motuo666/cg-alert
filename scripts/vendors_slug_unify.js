#!/usr/bin/env node
/**
 * vendors_slug_unify.js
 * 目标：将 vendors/<domain,Company> 统一为 vendors/<domain>
 * 行为：合并同域目录、保留已存在文件、移动缺失文件；生成 data/slug_unify_report.csv
 * 兼容：DRY=1 仅演练（不落地），否则执行落地
 * 注意：执行后建议跑 vendor_catalog.js 与 seo_inject.js 刷新索引与 SEO
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const VDIR = path.join(ROOT, 'vendors');
const RPT  = path.join(ROOT, 'data', 'slug_unify_report.csv');
const DRY  = process.env.DRY === '1' || process.argv.includes('--dry');

function normSlug(name) {
  // 取逗号前作为域名部分，lowercase + 去空格
  const s = String(name || '').trim();
  const d = s.split(',')[0].trim().toLowerCase();
  // 去掉尾部的斜杠/空格
  return d.replace(/[\/\s]+$/g, '');
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function sha1(p) {
  const h = crypto.createHash('sha1');
  h.update(await fsp.readFile(p));
  return h.digest('hex');
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function mergeDir(src, dst, stats) {
  await ensureDir(dst);
  const items = await fsp.readdir(src, { withFileTypes: true });
  for (const it of items) {
    const s = path.join(src, it.name);
    const d = path.join(dst, it.name);
    if (it.isDirectory()) {
      await mergeDir(s, d, stats);
      continue;
    }
    if (await exists(d)) {
      // 若同名文件已存在，尽量避免覆盖；相同内容则跳过，不同则保留目标、跳过来源
      try {
        const [a, b] = await Promise.all([sha1(s), sha1(d)]);
        if (a === b) {
          stats.skipped_same++;
        } else {
          stats.skipped_conflict++;
        }
      } catch {
        stats.skipped_conflict++;
      }
      continue;
    }
    if (!DRY) await fsp.rename(s, d);
    stats.moved++;
  }
}

async function tryRemoveEmpty(dir) {
  try {
    const ls = await fsp.readdir(dir);
    if (ls.length === 0 && !DRY) await fsp.rmdir(dir);
  } catch {}
}

async function walkVendors() {
  const out = [];
  let changed = 0;
  if (!await exists(VDIR)) {
    console.log('no vendors/ directory, skip');
    return { out, changed };
  }
  const entries = await fsp.readdir(VDIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const oldSlug = e.name;
    if (!oldSlug.includes(',')) continue; // 已规范
    const newSlug = normSlug(oldSlug);
    if (!newSlug || newSlug === oldSlug) continue;

    const oldDir = path.join(VDIR, oldSlug);
    const newDir = path.join(VDIR, newSlug);

    const stats = { moved: 0, skipped_same: 0, skipped_conflict: 0 };
    console.log(`${DRY ? '[DRY] ' : ''}unify: ${oldSlug} -> ${newSlug}`);
    if (!DRY) await ensureDir(newDir);
    await mergeDir(oldDir, newDir, stats);
    if (!DRY) {
      // 尝试清空残留空目录（可能还有子空目录）
      try {
        await fsp.rm(oldDir, { recursive: true, force: true });
      } catch {
        await tryRemoveEmpty(oldDir);
      }
    }
    out.push([oldSlug, newSlug, stats.moved, stats.skipped_same, stats.skipped_conflict]);
    changed++;
  }
  return { out, changed };
}

async function writeReport(rows) {
  await ensureDir(path.dirname(RPT));
  const header = 'old_slug,new_slug,moved,skipped_same,skipped_conflict\n';
  const body = rows.map(r => r.join(',')).join('\n');
  if (!DRY) await fsp.writeFile(RPT, header + body + (body ? '\n' : ''), 'utf8');
}

(async function main(){
  const { out, changed } = await walkVendors();
  await writeReport(out);
  console.log(`summary: ${changed} dir(s) unified`);
  if (out.length) console.log(`report: ${path.relative(ROOT, RPT)}`);
  if (DRY) console.log('DRY mode, no changes written.');
})();
