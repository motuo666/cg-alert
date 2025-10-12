#!/usr/bin/env node
/**
 * build_public_monthly.js
 * 产出：
 *  - reports/<YYYY-MM>/index.html
 *  - reports/index.html (指向最新月)
 *  - reports/rss.xml (最近 12 个月)
 * 规则：
 *  - evidence/<vendor>/<YYYY-MM-DD>.json 聚合
 *  - 类型粗分：pricing / tos / dpa / subprocessors / status / other
 *  - 幂等：反复跑无副作用
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://www.cg-alert.com';

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function ymd(d){ return d.toISOString().slice(0,10); }
function ymOf(ts){ return ts.toISOString().slice(0,7); }
function readJSON(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function detectType(obj, fname=''){
  const text = JSON.stringify(obj || {}).toLowerCase() + ' ' + fname.toLowerCase();
  if (/pricing|price|plan/.test(text)) return 'pricing';
  if (/\btos\b|terms of service|terms/.test(text)) return 'tos';
  if (/\bdpa\b|data processing/.test(text)) return 'dpa';
  if (/subprocessor|sub-?processor/.test(text)) return 'subprocessors';
  if (/status|incident|uptime/.test(text)) return 'status';
  return 'other';
}
function listEvidence(){
  const base = path.join(ROOT, 'evidence');
  const out = [];
  if (!fs.existsSync(base)) return out;
  for (const vd of fs.readdirSync(base, { withFileTypes: true })) {
    if (!vd.isDirectory()) continue;
    const slug = vd.name;
    const dir = path.join(base, slug);
    for (const f of fs.readdirSync(dir)) {
      if (!/\.json$/i.test(f)) continue;
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      const obj = readJSON(p) || {};
      const type = detectType(obj, f);
      out.push({ slug, file: p, mtime: st.mtime, type, url: `${SITE}/vendors/${encodeURIComponent(slug)}/` });
    }
  }
  return out.sort((a,b)=>b.mtime - a.mtime);
}
function monthBuckets(items){
  const m = new Map();
  for (const it of items) {
    const ym = ymOf(it.mtime);
    if (!m.has(ym)) m.set(ym, []);
    m.get(ym).push(it);
  }
  return m; // Map<YYYY-MM, items[]>
}
function htmlEscape(s){return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));}

function renderMonthHTML(ym, items){
  const groups = {};
  for (const it of items) {
    groups[it.slug] ||= { slug: it.slug, types: new Set(), latest: it.mtime };
    groups[it.slug].types.add(it.type);
    if (it.mtime > groups[it.slug].latest) groups[it.slug].latest = it.mtime;
  }
  const rows = Object.values(groups)
    .sort((a,b)=>b.latest - a.latest)
    .map(g=>{
      const badges = [...g.types].map(t=>`<span class="b b-${t}">${t}</span>`).join(' ');
      return `<tr>
        <td><a href="/vendors/${encodeURIComponent(g.slug)}/">${htmlEscape(g.slug)}</a></td>
        <td>${badges}</td>
        <td>${ymd(g.latest)}</td>
      </tr>`;
    }).join('\n');

  const title = `Public Changes — ${ym} · CG Alert`;
  const desc  = `Evidence-backed public changes (${ym}).`;
  const canon = `${SITE}/reports/${ym}/`;

  const head = `
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${canon}">
<script type="application/ld+json">${JSON.stringify({
  "@context":"https://schema.org",
  "@type":"Report",
  "name": title,
  "datePublished": `${ym}-01`,
  "url": canon,
  "publisher": {"@type":"Organization","name":"CG Alert","url":SITE}
})}</script>`.trim();

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;color:#111}
.wrap{max-width:980px;margin:0 auto;padding:28px 16px}
h1{font-size:28px;margin:8px 0 16px}
table{width:100%;border-collapse:collapse}
th,td{padding:10px;border-bottom:1px solid #eee;text-align:left;font-size:15px}
.b{display:inline-block;font-size:12px;padding:2px 8px;border:1px solid #ddd;border-radius:999px;margin-right:6px}
.b-pricing{background:#f5faff}
.b-tos{background:#fff7e6}
.b-dpa{background:#f6fff3}
.b-subprocessors{background:#fef6ff}
.b-status{background:#f1fff9}
footer{margin-top:28px;color:#666;font-size:13px}
.nav a{margin-right:10px}
</style></head>
<body>
<div class="wrap">
  <div class="nav"><a href="/reports/">Reports</a> · <a href="/updates/">Updates</a> · <a href="/channel/">Channel</a></div>
  <h1>Public Changes — ${ym}</h1>
  <p>Evidence-backed changes on vendors’ public pages (Pricing / ToS / DPA / Subprocessors / Status).</p>
  <table>
    <thead><tr><th>Vendor</th><th>Types</th><th>Last Update</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No changes this month.</td></tr>'}</tbody>
  </table>
  <footer>© ${new Date().getFullYear()} CG Alert</footer>
</div>
</body></html>`;
}

function renderIndexHTML(latestYM, months){
  const links = months.map(m=>`<li><a href="/reports/${m}/">${m}</a></li>`).join('\n');
  const head = `
<title>Reports — CG Alert</title>
<meta name="description" content="Monthly evidence-backed public changes.">
<link rel="canonical" href="${SITE}/reports/">
<link rel="alternate" type="application/rss+xml" title="CG Alert Reports RSS" href="${SITE}/reports/rss.xml">`.trim();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;color:#111}
.wrap{max-width:720px;margin:0 auto;padding:28px 16px}
h1{font-size:28px;margin:8px 0 16px}
li{margin:8px 0}
</style></head>
<body>
<div class="wrap">
  <h1>Reports</h1>
  <p>Latest: <a href="/reports/${latestYM}/">${latestYM}</a></p>
  <ul>${links}</ul>
</div></body></html>`;
}

function renderRSS(items){
  const lastBuild = new Date().toUTCString();
  const head = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>CG Alert — Monthly Reports</title>
<link>${SITE}/reports/</link>
<description>Evidence-backed changes on vendors’ public pages</description>
<lastBuildDate>${lastBuild}</lastBuildDate>`;
  const body = items.slice(0, 12).map(({ ym, count }) => `
<item>
  <title>${ym} — ${count} changes</title>
  <link>${SITE}/reports/${ym}/</link>
  <guid>${SITE}/reports/${ym}/</guid>
  <pubDate>${new Date(`${ym}-01`).toUTCString()}</pubDate>
  <description>${count} evidence-backed changes</description>
</item>`).join('\n');
  return `${head}${body}\n</channel></rss>`;
}

(function main(){
  const argMonth = (process.argv.find(a=>a.startsWith('--month='))||'').split('=')[1] || '';
  const all = listEvidence();
  const buckets = monthBuckets(all);
  const months = [...buckets.keys()].sort().reverse();
  const targetYM = argMonth || (months[0] || new Date().toISOString().slice(0,7));

  // 生成目标月页面
  const items = buckets.get(targetYM) || [];
  const outDir = path.join(ROOT, 'reports', targetYM);
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, 'index.html'), renderMonthHTML(targetYM, items));

  // 生成 reports/index.html 与 rss.xml（最近 12 个月）
  const latestYM = targetYM;
  const list = months.length ? months : [targetYM];
  const idxDir = path.join(ROOT, 'reports');
  ensureDir(idxDir);
  fs.writeFileSync(path.join(idxDir, 'index.html'), renderIndexHTML(latestYM, list));
  const rssItems = list.map(ym => ({ ym, count: (buckets.get(ym) || []).length }));
  fs.writeFileSync(path.join(idxDir, 'rss.xml'), renderRSS(rssItems));

  console.log(`[reports] built for ${targetYM}, months=${list.length}`);
})();
