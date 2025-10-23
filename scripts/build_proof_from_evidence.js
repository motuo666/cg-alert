#!/usr/bin/env node
/**
 * 从 evidence/<vendor>/*.json 生成：
 * 1) 每条证据对应的详情页：reports/proof/<vendor>/<basename>.html
 * 2) 按月聚合索引：reports/proof/<vendor>/<YYYY-MM>/index.html
 * 兼容你现有文件名：YYYY-MM-DD-<Type>-<hash>.json（hash 可能为 00000000/e3b0c442 等占位）
 */
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const EVD = path.join(ROOT, 'evidence');
const OUT = path.join(ROOT, 'reports', 'proof');

const esc = s => String(s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const ensure = p => fs.mkdirSync(p, { recursive:true });
const byMonth = new Map();

function renderDoc(vendor, meta, hrefJson){
  const title = `${vendor} · ${meta.date} · ${meta.type}`;
  const hashShort = meta.hash ? `#${meta.hash.slice(0,8).toLowerCase()}` : '—';
  return `<!doctype html><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,Segoe UI,Arial;line-height:1.55;max-width:880px;margin:24px auto;padding:0 16px}
h1{font-size:20px} table{border-collapse:collapse;width:100%} td,th{border:1px solid #ddd;padding:8px}</style>
<h1>${esc(title)} <small style="color:#666">${hashShort}</small></h1>
<p><b>URL:</b> <a href="${esc(meta.url)}" rel="nofollow">${esc(meta.url)}</a></p>
<table><tbody>
<tr><th>Date</th><td>${esc(meta.date)}</td></tr>
<tr><th>Type</th><td>${esc(meta.type)}</td></tr>
<tr><th>Commit</th><td>${esc(meta.commit||'')}</td></tr>
<tr><th>Hash</th><td>${esc(meta.hash||'')}</td></tr>
<tr><th>Evidence JSON</th><td><a href="${esc(hrefJson)}">${esc(hrefJson)}</a></td></tr>
</tbody></table>
<p style="color:#666">Note: This is a static proof page rendered from JSON. For full diff context, use the Evidence link.</p>`;
}

function renderIndex(vendor, ym, items){
  const rows = items.map(x => `<tr>
    <td>${esc(x.date)}</td>
    <td>${esc(x.type)}</td>
    <td>${x.hash ? `<code>#${esc(x.hash.slice(0,8))}</code>` : '—'}</td>
    <td><a href="../${esc(x.basename)}.html">proof</a></td>
    <td><a href="/${esc(x.jsonRel)}">evidence</a></td>
  </tr>`).join('\n');
  return `<!doctype html><meta charset="utf-8">
<title>${esc(vendor)} · ${esc(ym)} · Proof Index</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,Segoe UI,Arial;line-height:1.55;max-width:880px;margin:24px auto;padding:0 16px}
h1{font-size:20px} table{border-collapse:collapse;width:100%} td,th{border:1px solid #ddd;padding:8px}</style>
<h1>${esc(vendor)} · ${esc(ym)} · Proof</h1>
<table><thead><tr><th>Date</th><th>Type</th><th>Hash</th><th>Proof</th><th>Evidence</th></tr></thead>
<tbody>${rows || `<tr><td colspan="5">No items</td></tr>`}</tbody></table>`;
}

if (!fs.existsSync(EVD)) process.exit(0);
for (const vendor of fs.readdirSync(EVD)) {
  const dir = path.join(EVD, vendor);
  if (!fs.statSync(dir).isDirectory()) continue;
  const outVendor = path.join(OUT, vendor); ensure(outVendor);

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const fp = path.join(dir, f);
    let json={}; try { json = JSON.parse(fs.readFileSync(fp,'utf8')); } catch {}
    const m = f.match(/^(\d{4}-\d{2}-\d{2})-([^\.]+?)-([0-9a-fA-F]{6,}|0{6,}|e3b0c442)[.]json$/) || [];
    const date = (json.detected_at||'').slice(0,10) || (m[1]||'');
    const type = json.type || (m[2]||'').replace(/_/g,' ');
    const hash = (json.sha256 || json.hash || (m[3]||'')).toString();
    const basename = f.replace(/\.json$/,'');
    const jsonRel = path.posix.join('evidence', vendor, f);

    // 单页 proof
    const html = renderDoc(vendor, { date, type, hash, url:json.url||'', commit:json.commit||'' }, '/'+jsonRel);
    fs.writeFileSync(path.join(outVendor, `${basename}.html`), html, 'utf8');

    // 月索引
    const ym = (date||'').slice(0,7) || 'unknown';
    const key = `${vendor}/${ym}`;
    const arr = byMonth.get(key) || [];
    arr.push({ date, type, hash, basename, jsonRel });
    byMonth.set(key, arr);
  }
}

// 写月索引
for (const [key, items] of byMonth.entries()) {
  const [vendor, ym] = key.split('/');
  const outDir = path.join(OUT, vendor, ym); ensure(outDir);
  fs.writeFileSync(path.join(outDir, 'index.html'), renderIndex(vendor, ym, items), 'utf8');
}
console.log('build_proof_from_evidence: ok');
