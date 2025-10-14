#!/usr/bin/env node
/**
 * build_public_monthly.js — 生成 /reports/ 与 /reports/YYYY-MM/
 * 目标：保持极简、对齐站点风格（不改配色口径），增加摘要、面包屑、RSS、JSON-LD。
 * 数据源：evidence/<slug>/<YYYY-MM-DD>-<Type>-<hash>.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVD  = path.join(ROOT, 'evidence');
const OUT  = path.join(ROOT, 'reports');
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const MAX_MONTHS_ON_INDEX = 12;

function ensureDir(p){ fs.mkdirSync(p, {recursive:true}); }

function listEvidence() {
  if (!fs.existsSync(EVD)) return [];
  const vendors = fs.readdirSync(EVD).filter(d => fs.statSync(path.join(EVD, d)).isDirectory());
  const items = [];
  for (const slug of vendors) {
    const dir = path.join(EVD, slug);
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}-/.test(f) || !f.endsWith('.json')) continue;
      const [dateStr, type] = f.replace('.json','').split('-').slice(0,2+1); // YYYY-MM-DD-Type-...
      const y = dateStr.slice(0,4), m = dateStr.slice(5,7);
      const ym = `${y}-${m}`;
      items.push({ slug, date: dateStr, ym, type, file: path.join(dir,f) });
    }
  }
  // 新→旧
  items.sort((a,b)=> (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return items;
}

function monthBuckets(items){
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.ym)) map.set(it.ym, []);
    map.get(it.ym).push(it);
  }
  // 近到远
  return Array.from(map.entries()).sort((a,b)=> a[0] < b[0] ? 1 : -1);
}

function htmlHead({title, canonical}) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="canonical" href="${canonical}">
<link rel="alternate" type="application/rss+xml" title="CG Alert Reports RSS" href="${ORIGIN}/reports/rss.xml">
<style>
  :root { --fg:#0b0b0b; --muted:#666; --link:#0b57d0; }
  body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif; color:var(--fg); margin:0; }
  .wrap { max-width: 920px; margin: 32px auto 64px; padding: 0 16px; }
  h1 { font-size: 28px; margin: 0 0 12px; }
  .muted { color: var(--muted); font-size: 14px; }
  .crumb { font-size:14px; margin: 8px 0 16px; }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .summary { display:flex; gap:16px; flex-wrap:wrap; margin: 8px 0 16px; }
  .pill { padding:6px 10px; border-radius:999px; background:#f5f5f5; font-size:13px; }
  ul.list { margin: 8px 0 24px 20px; line-height:1.6; }
  .grid { width:100%; border-collapse:collapse; margin:10px 0 24px; }
  .grid th,.grid td { border-bottom:1px solid #eee; padding:8px 6px; text-align:left; }
  .right { text-align:right; }
  footer { margin-top: 36px; font-size: 13px; color: var(--muted); }
</style>
<script type="application/ld+json">{
  "@context":"https://schema.org",
  "@type":"BreadcrumbList",
  "itemListElement":[
    {"@type":"ListItem","position":1,"name":"Reports","item":"${ORIGIN}/reports/"}
  ]
}</script>
</head><body><div class="wrap">`;
}

function htmlFoot(){ return `<footer>© CG Alert — Evidence-backed vendor change alerts.</footer></div></body></html>`; }

function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function writeIndex(months){
  ensureDir(OUT);
  const latest = months[0]?.[0] || '';
  const title = 'Reports';
  const canonical = `${ORIGIN}/reports/`;
  const links = months.slice(0, MAX_MONTHS_ON_INDEX).map(([ym]) => `<li><a href="${ym}/">${ym}</a></li>`).join('');
  const html = [
    htmlHead({title, canonical}),
    `<h1>Reports</h1>`,
    latest ? `<div class="muted">Latest: <a href="${latest}/">${latest}</a></div>` : `<div class="muted">No reports yet.</div>`,
    `<ul class="list">${links}</ul>`,
    htmlFoot()
  ].join('');
  fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
}

function monthSummary(items){
  const vendors = new Map();
  const types   = new Map();
  for (const it of items) {
    vendors.set(it.slug, (vendors.get(it.slug)||0)+1);
    types.set(it.type, (types.get(it.type)||0)+1);
  }
  const topVendors = Array.from(vendors.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const typePills = Array.from(types.entries()).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="pill">${escapeHtml(k)} · ${v}</span>`).join('');
  return { total: items.length, vendorCount: vendors.size, topVendors, typePills };
}

function writeMonth(ym, items){
  const dir = path.join(OUT, ym);
  ensureDir(dir);
  const title = `Public Changes — ${ym}`;
  const canonical = `${ORIGIN}/reports/${ym}/`;
  const { total, vendorCount, topVendors, typePills } = monthSummary(items);

  // 列表（按日期新→旧）
  const lis = items.map(it=>{
    const d = it.date;
    const slug = it.slug;
    const vendorUrl = `${ORIGIN}/vendors/${slug}/`;
    return `<li>${d} · <a href="${vendorUrl}">${escapeHtml(slug)}</a></li>`;
  }).join('');

  const topTable = topVendors.length ? `
<table class="grid">
  <thead><tr><th>Vendor</th><th class="right">Changes</th></tr></thead>
  <tbody>${topVendors.map(([slug,c])=>`<tr><td><a href="${ORIGIN}/vendors/${slug}/">${escapeHtml(slug)}</a></td><td class="right">${c}</td></tr>`).join('')}</tbody>
</table>` : '';

  const html = [
    htmlHead({title, canonical}).replace('"itemListElement":[', `"itemListElement":[{"@type":"ListItem","position":1,"name":"Reports","item":"${ORIGIN}/reports/"},{"@type":"ListItem","position":2,"name":"${ym}","item":"${canonical}"],`),
    `<div class="crumb"><a href="${ORIGIN}/reports/">Reports</a> / ${ym}</div>`,
    `<h1>${escapeHtml(title)}</h1>`,
    `<div class="summary">
       <span class="pill">Total changes · ${total}</span>
       <span class="pill">Vendors · ${vendorCount}</span>
       ${typePills}
     </div>`,
    topTable,
    `<ul class="list">${lis}</ul>`,
    htmlFoot()
  ].join('');

  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

function writeRSS(months){
  const items = months.slice(0, MAX_MONTHS_ON_INDEX).map(([ym, arr]) => {
    const link = `${ORIGIN}/reports/${ym}/`;
    const title = `Public Changes — ${ym}`;
    const pubDate = new Date(arr[0]?.date || `${ym}-01`).toUTCString();
    return `<item><title>${escapeHtml(title)}</title><link>${link}</link><guid>${link}</guid><pubDate>${pubDate}</pubDate></item>`;
  }).join('');
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>CG Alert · Reports</title>
  <link>${ORIGIN}/reports/</link>
  <description>Monthly public changes across monitored vendors</description>
  ${items}
</channel></rss>`;
  fs.writeFileSync(path.join(OUT, 'rss.xml'), rss, 'utf8');
}

(function main(){
  const all = listEvidence();
  const months = monthBuckets(all);
  if (months.length === 0) {
    ensureDir(OUT);
    fs.writeFileSync(path.join(OUT, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Reports</title><div class="wrap"><h1>Reports</h1><p>No reports yet.</p></div>');
    return;
  }
  writeIndex(months);
  for (const [ym, arr] of months) writeMonth(ym, arr);
  writeRSS(months);
  console.log(`reports: index + ${months.length} months built`);
})();
