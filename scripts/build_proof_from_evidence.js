#!/usr/bin/env node
/**
 * build_proof_from_evidence.js
 * 将 evidence/**/*.json 生成“对外可见”的快照页，并产出 vendor+月份索引页。
 * 还会写入 artifacts/proof_map.json 供后续替换器使用。
 *
 * 环境变量：
 *   PROOF_BASE  例如 https://www.cg-alert.com/reports/proof  （仅用于 <link rel="canonical">）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVD_DIR = path.join(ROOT, 'evidence');
const OUT_ROOT = path.join(ROOT, 'reports', 'proof');
const ART_DIR = path.join(ROOT, 'artifacts');
const MAP_FILE = path.join(ART_DIR, 'proof_map.json');
const PROOF_BASE = process.env.PROOF_BASE || '';

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.isFile() && ent.name.endsWith('.json')) acc.push(p);
  }
  return acc;
}
function readJSON(fp){ try{ return JSON.parse(fs.readFileSync(fp,'utf8')); }catch{ return null; } }
function ensureDir(d){ fs.mkdirSync(d, { recursive:true }); }
function slug(s){ return (s||'').toString().trim().toLowerCase().replace(/[^a-z0-9\-_.]+/g, '-').replace(/-+/g,'-').replace(/^-|-$/g,''); }
function isoDate(d){ return d ? new Date(d).toISOString() : ''; }
function getHostFromURL(u){
  try{ return new URL(u).hostname.toLowerCase(); }catch{ return ''; }
}
function inferVendor(fp, j){
  return (j && (j.vendor||j.domain||getHostFromURL(j.url))) ||
         fp.split(path.sep).slice(-3)[0] || // evidence/<vendor>/<maybe-ym>/file.json
         'unknown';
}
function ymFromJson(j, fp){
  const d = j?.observed_at || j?.fetched_at || '';
  if (d && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0,7);
  const m = fp.match(/(\d{4}-\d{2})/);
  return m ? m[1] : 'unknown';
}
function baseNameNoExt(fp){ return path.basename(fp).replace(/\.json$/,''); }

function buildHTML(vendor, ym, j, canonPathRel){
  const t = j?.title || j?.page_title || j?.url || `${vendor} snapshot`;
  const src = j?.url || '';
  const observed = j?.observed_at || j?.fetched_at || '';
  const eff = j?.effective_date || j?.source_last_modified || j?.page_last_modified || j?.date || '';
  const hash = j?.hash || j?.fingerprint || j?.sha256 || '';

  const canonical = PROOF_BASE && canonPathRel
      ? (PROOF_BASE.replace(/\/+$/,'') + '/' + canonPathRel.replace(/^\/+/,''))
      : '';

  return `<!doctype html><html><head><meta charset="utf-8">
<title>${escapeHtml(t)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
<style>
body{font-family:system-ui,Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;line-height:1.6;color:#111827}
h1{font-size:22px;margin:0 0 12px}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0;box-shadow:0 1px 2px rgba(0,0,0,.03);background:#fff}
.kv{display:flex;justify-content:space-between;border-bottom:1px dashed #eee;padding:6px 0}
small{color:#6b7280}
pre{white-space:pre-wrap;word-wrap:break-word;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px}
a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}
</style></head><body>
<h1>${escapeHtml(t)}</h1>
<div class="card">
  <div class="kv"><div>Vendor</div><div><b>${escapeHtml(vendor)}</b></div></div>
  <div class="kv"><div>Month</div><div>${ym}</div></div>
  <div class="kv"><div>Observed</div><div>${escapeHtml(observed || '—')}</div></div>
  <div class="kv"><div>Source date</div><div>${escapeHtml(eff || '—')}</div></div>
  <div class="kv"><div>Hash</div><div><code>${escapeHtml(hash || '—')}</code></div></div>
  <div class="kv"><div>Source URL</div><div>${src ? `<a href="${escapeAttr(src)}" target="_blank" rel="noopener">Open</a>` : '—'}</div></div>
  <p><small>Snapshot generated from evidence JSON. Private pipeline metadata (like run_url) is stripped.</small></p>
</div>

${j?.excerpt ? `<div class="card"><h3>Excerpt</h3><pre>${escapeHtml(j.excerpt)}</pre></div>` : ''}

</body></html>`;
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }

function main(){
  const files = walk(EVD_DIR);
  const map = {};
  let count = 0;

  for (const fp of files){
    const j = readJSON(fp);
    if (!j) continue;

    // 生成快照输出路径
    const vendor = slug(inferVendor(fp, j));
    const ym = ymFromJson(j, fp);
    const name = slug(baseNameNoExt(fp)) || 'item';

    const outDir = path.join(OUT_ROOT, vendor, ym);
    ensureDir(outDir);
    const outHtml = path.join(outDir, name + '.html');

    // 页面
    const relForCanonical = ['reports','proof',vendor,ym,(name + '.html')].join('/');
    const html = buildHTML(vendor, ym, j, relForCanonical);
    fs.writeFileSync(outHtml, html, 'utf8');

    // 记录映射（便于后续替换）
    const key = path.relative(EVD_DIR, fp).replace(/\\/g,'/');
    map[key] = {
      vendor, ym, file: (vendor + '/' + ym + '/' + name + '.html')
    };
    count++;
  }

  // 写映射
  ensureDir(ART_DIR);
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2));

  // 生成 vendor+月份索引页
  buildIndexes();

  console.log(`proof snapshots built: ${count}, map=${path.relative(ROOT, MAP_FILE)}`);
}

function buildIndexes(){
  if (!fs.existsSync(OUT_ROOT)) return;
  for (const vendor of fs.readdirSync(OUT_ROOT)){
    const vdir = path.join(OUT_ROOT, vendor);
    if (!fs.statSync(vdir).isDirectory()) continue;
    for (const ym of fs.readdirSync(vdir)){
      const d = path.join(vdir, ym);
      if (!fs.statSync(d).isDirectory()) continue;

      const items = fs.readdirSync(d).filter(f => f.endsWith('.html')).sort();
      const list = items.map(f => `<li><a href="./${f}" target="_blank" rel="noopener">${f}</a></li>`).join('\n');

      const canonical = PROOF_BASE
        ? PROOF_BASE.replace(/\/+$/,'') + '/' + [vendor, ym, 'index.html'].join('/')
        : '';

      const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Snapshots — ${vendor} ${ym}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
<style>body{font-family:system-ui,Arial;margin:24px}li{margin:6px 0}a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}</style>
</head><body>
<h1>Snapshots — ${vendor} ${ym}</h1>
<ul>${list||'<li>Empty</li>'}</ul>
</body></html>`;
      fs.writeFileSync(path.join(d,'index.html'), html, 'utf8');
    }
  }
}

main();
