#!/usr/bin/env node
/**
 * build_proof_from_evidence.js — 生成站内“Proof 快照”HTML
 *
 * 规则：
 * - 扫描 evidence/<vendor>/*.json
 * - 生成 reports/proof/<vendor>/<basename>.html （basename = 证据 JSON 文件名去掉 .json）
 * - 若存在截图：screenshots/<vendor>/<basename>.png，则在页面内展示
 * - 页面内仅包含：来源 URL、检测时间、hash、可选截图；不包含任何仓库/Action 链接
 * - 兼容大小写/slug 差异：额外生成一个全小写别名，做 301 Meta Refresh 到规范文件
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVD  = path.join(ROOT, 'evidence');
const SHOTS = path.join(ROOT, 'screenshots');
const OUT  = path.join(ROOT, 'reports', 'proof');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const d of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(p));
    else if (d.isFile() && p.endsWith('.json')) out.push(p);
  }
  return out;
}

function safeMkdir(p) { fs.mkdirSync(p, {recursive:true}); }

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function buildHTML(vendor, base, j) {
  const title = `${vendor} — Proof snapshot`;
  const shotPath = path.join(SHOTS, vendor, `${base}.png`);
  const hasShot = fs.existsSync(shotPath);
  const relShot = hasShot ? path.relative(path.join(ROOT,'reports'), shotPath).replace(/\\/g,'/') : null; // 相对 /reports

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="robots" content="noindex">
<style>
  body{font-family:system-ui,Arial;margin:24px;color:#111}
  .card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;max-width:980px}
  .kv{display:flex;gap:12px;margin:8px 0}
  .kv b{min-width:140px}
  .btn{display:inline-block;margin-top:12px;padding:8px 12px;border:1px solid #111;border-radius:8px;text-decoration:none;color:#111}
  .shot{margin-top:16px;border:1px solid #e5e7eb;border-radius:12px;max-width:100%}
  small{color:#6b7280}
</style>
</head>
<body>
<h1>Proof snapshot</h1>
<div class="card">
  <div class="kv"><b>Vendor</b><span>${esc(vendor)}</span></div>
  <div class="kv"><b>Source URL</b><a href="${esc(j.url||'')}" target="_blank" rel="noopener">${esc(j.url||'')}</a></div>
  <div class="kv"><b>Detected at</b><span>${esc(j.detected_at||j.observed_at||'')}</span></div>
  <div class="kv"><b>Hash</b><code>${esc(j.sha256||j.hash||'')}</code></div>
  <a class="btn" href="${esc(j.url||'')}" target="_blank" rel="noopener">Open source</a>
  ${hasShot ? `<div><img class="shot" src="/${esc(relShot)}" alt="snapshot"></div>` : ''}
  <p><small>This page is a frozen reference rendered by CG Alert. It contains no links to internal CI or repositories.</small></p>
</div>
</body></html>`;
}

function toLowerAliasName(name) {
  // 只把文件名部分转小写，保留扩展
  const i = name.lastIndexOf('.');
  if (i < 0) return name.toLowerCase();
  return name.slice(0,i).toLowerCase() + name.slice(i);
}

function main(){
  const evFiles = walk(EVD);
  let created = 0;
  for (const fp of evFiles) {
    const vendor = path.basename(path.dirname(fp));               // evidence/<vendor>/<file>.json
    const base   = path.basename(fp).replace(/\.json$/,'');       // <basename>
    const outDir = path.join(OUT, vendor);
    const outFile = path.join(outDir, `${base}.html`);

    const j = readJSON(fp);
    if (!j || !j.url) continue;

    safeMkdir(outDir);
    fs.writeFileSync(outFile, buildHTML(vendor, base, j), 'utf8');
    created++;

    // 兼容大小写链接差异：生成一个小写别名，做 0 秒跳转到规范文件
    const alias = path.join(outDir, toLowerAliasName(`${base}.html`));
    if (!fs.existsSync(alias) && alias !== outFile) {
      fs.writeFileSync(alias,
        `<!doctype html><meta http-equiv="refresh" content="0; url=./${encodeURIComponent(path.basename(outFile))}">`,
        'utf-8'
      );
    }
  }
  console.log(`proof pages created: ${created}`);
}

main();
