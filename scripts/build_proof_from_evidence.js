#!/usr/bin/env node
/**
 * build_proof_from_evidence.js
 * - 将 evidence/**/*.json 转为对外可见的本地快照页：
 *     reports/proof/<vendor>/<basename>.html
 * - 页面只展示关键字段（url/title/hash/observed_at 等），不暴露内部 run 链接
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVD_DIR = path.join(ROOT, 'evidence');
const OUT_DIR = path.join(ROOT, 'reports', 'proof');

function walk(dir, acc=[]) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.isFile() && ent.name.endsWith('.json')) acc.push(p);
  }
  return acc;
}
function esc(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const files = walk(EVD_DIR);
let ok = 0, fail = 0;

for (const fp of files) {
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const rel = path.relative(EVD_DIR, fp);            // e.g. paddle.com/2025-10-18-xxx.json
    const vendor = rel.split(path.sep)[0] || 'unknown';
    const base = path.basename(rel).replace(/\.json$/i, '');
    const outDir = path.join(OUT_DIR, vendor);
    const out = path.join(outDir, base + '.html');

    const url = j.url || '';
    const title = j.title || j.page_title || '';
    const hash = j.sha256 || j.hash || '';
    const observed = j.observed_at || j.fetched_at || '';
    const effective = j.effective_date || j.source_last_modified || j.page_last_modified || j.date || '';

    const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snapshot — ${esc(vendor)} — ${esc(base)}</title>
<style>
body{font-family:system-ui,Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 12px;line-height:1.6;color:#111}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0;background:#fff}
.kv{display:flex;gap:12px}
.kv div:first-child{min-width:140px;color:#374151}
pre{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;overflow:auto}
a{color:#2563eb;text-decoration:none}
a:hover{text-decoration:underline}
small{color:#6b7280}
</style></head><body>
<h1>Snapshot</h1>

<div class="card">
  <div class="kv"><div>Vendor</div><div>${esc(vendor)}</div></div>
  <div class="kv"><div>Title</div><div>${esc(title)}</div></div>
  <div class="kv"><div>Source URL</div><div>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>` : '-'}</div></div>
  <div class="kv"><div>Observed at</div><div>${esc(observed)}</div></div>
  <div class="kv"><div>Source date</div><div>${esc(effective)}</div></div>
  <div class="kv"><div>Fingerprint</div><div><code>${esc(hash)}</code></div></div>
  <p><small>Note: This page is a local, stable snapshot descriptor for external sharing.</small></p>
</div>

<div class="card">
  <h3>Raw JSON (redacted)</h3>
  <pre>${esc(JSON.stringify({
    url, title, observed_at: observed, effective_date: effective, hash
  }, null, 2))}</pre>
</div>

</body></html>`;

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(out, html, 'utf8');
    ok++;
  } catch (e) {
    fail++;
  }
}

console.log(`build_proof_from_evidence: ok=${ok}, fail=${fail}, out=${path.relative(ROOT, OUT_DIR)}`);
