#!/usr/bin/env node
/**
 * v10.1 — Reports Builder
 * 目标：统一风格；生成 /reports/ 与 /reports/YYYY-MM/；输出 RSS、index.json、sitemap-reports.xml，并智能更新 sitemap-index.xml。
 * 数据源：evidence/<slug>/<YYYY-MM-DD>-<Type>-<hash>.json
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const EVD  = path.join(ROOT, 'evidence');
const OUT  = path.join(ROOT, 'reports');
const ORIGIN = (process.env.SITE_ORIGIN || 'https://www.cg-alert.com').replace(/\/+$/,'');
const MAX_MONTHS_ON_INDEX = 12;

const esc = s => String(s).replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));

function ensure(p){ fs.mkdirSync(p,{recursive:true}); }
function readEvidence() {
  if (!fs.existsSync(EVD)) return [];
  const items = [];
  for (const slug of fs.readdirSync(EVD)) {
    const dir = path.join(EVD, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}-/.test(f) || !f.endsWith('.json')) continue;
      const [dateStr, type] = f.replace('.json','').split('-').slice(0,2+1);
      const ym = `${dateStr.slice(0,4)}-${dateStr.slice(5,7)}`;
      items.push({ slug, date: dateStr, ym, type, file: path.join(dir,f) });
    }
  }
  items.sort((a,b)=> a.date < b.date ? 1 : -1); // 新→旧
  return items;
}
function bucketByMonth(items){
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.ym)) map.set(it.ym, []);
    map.get(it.ym).push(it);
  }
  return Array.from(map.entries()).sort((a,b)=> a[0] < b[0] ? 1 : -1); // 新→旧
}

function head({title, canonical, breadcrumbs=[]}) {
  const ld = {
    "@context":"https://schema.org",
    "@type":"BreadcrumbList",
    "itemListElement": breadcrumbs.map((b,i)=>({
      "@type":"ListItem","position":i+1,"name":b.name,"item":b.url
    }))
  };
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="canonical" href="${canonical}">
<link rel="alternate" type="application/rss+xml" title="CG Alert Reports RSS" href="${ORIGIN}/reports/rss.xml">
<style>
:root { --fg:#0b0b0b; --muted:#666; --link:#0b57d0; }
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;margin:0;color:var(--fg)}
.wrap{max-width:920px;margin:32px auto 64px;padding:0 16px}
h1{font-size:28px;margin:0 0 12px}
.muted{color:var(--muted);font-size:14px}
.crumb{font-size:14px;margin:8px 0 16px}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
.summary{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 16px}
.pill{padding:6px 10px;border-radius:999px;background:#f5f5f5;font-size:13px}
ul.list{margin:8px 0 24px 20px;line-height:1.6}
.grid{width:100%;border-collapse:collapse;margin:10px 0 24px}
.grid th,.grid td{border-bottom:1px solid #eee;padding:8px 6px;text-align:left}
.right{text-align:right}
footer{margin-top:36px;font-size:13px;color:var(--muted)}
</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head><body><div class="wrap">`;
}
const foot = () => `<footer>© CG Alert — Evidence-backed vendor change alerts.</footer></div></body></html>`;

function writeIndex(months){
  ensure(OUT);
  const title='Reports', canonical=`${ORIGIN}/reports/`;
  const list = months.slice(0,MAX_MONTHS_ON_INDEX)
    .map(([ym])=>`<li><a href="${ym}/">${ym}</a></li>`).join('');
  const latest = months[0]?.[0];
  const html = [
    head({title, canonical, breadcrumbs:[{name:'Reports',url:canonical}]}),
    `<h1>Reports</h1>`,
    latest ? `<div class="muted">Latest: <a href="${latest}/">${latest}</a></div>` : `<div class="muted">No reports yet.</div>`,
    `<ul class="list">${list}</ul>`,
    foot()
  ].join('');
  fs.writeFileSync(path.join(OUT,'index.html'), html, 'utf8');

  // 同步 index.json（供客户端/脚本消费）
  const j = months.map(([ym, arr])=>({ month: ym, total: arr.length }));
  fs.writeFileSync(path.join(OUT,'index.json'), JSON.stringify(j, null, 2));
}

function monthSummary(items){
  const vendors=new Map(), types=new Map();
  for(const it of items){ vendors.set(it.slug,(vendors.get(it.slug)||0)+1); types.set(it.type,(types.get(it.type)||0)+1); }
  const top=[...vendors.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
  const pills=[...types.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="pill">${esc(k)} · ${v}</span>`).join('');
  return { total: items.length, vendorCount: vendors.size, top, pills };
}
function writeMonth(ym, items){
  const dir=path.join(OUT, ym); ensure(dir);
  const canonical=`${ORIGIN}/reports/${ym}/`;
  const title=`Public Changes — ${ym}`;
  const { total, vendorCount, top, pills } = monthSummary(items);
  const lis = items.map(it=>{
    const link = `${ORIGIN}/vendors/${it.slug}/`;
    return `<li>${it.date} · <a href="${link}">${esc(it.slug)}</a></li>`;
  }).join('');
  const topTable = top.length ? `
<table class="grid">
  <thead><tr><th>Vendor</th><th class="right">Changes</th></tr></thead>
  <tbody>${top.map(([slug,c])=>`<tr><td><a href="${ORIGIN}/vendors/${slug}/">${esc(slug)}</a></td><td class="right">${c}</td></tr>`).join('')}</tbody>
</table>` : '';

  const html = [
    head({title, canonical, breadcrumbs:[{name:'Reports',url:`${ORIGIN}/reports/`},{name:ym,url:canonical}]}),
    `<div class="crumb"><a href="${ORIGIN}/reports/">Reports</a> / ${ym}</div>`,
    `<h1>${esc(title)}</h1>`,
    `<div class="summary"><span class="pill">Total · ${total}</span><span class="pill">Vendors · ${vendorCount}</span>${pills}</div>`,
    topTable,
    `<ul class="list">${lis}</ul>`,
    foot()
  ].join('');
  fs.writeFileSync(path.join(dir,'index.html'), html, 'utf8');
}

function writeRSS(months){
  const items = months.slice(0,MAX_MONTHS_ON_INDEX).map(([ym, arr])=>{
    const link = `${ORIGIN}/reports/${ym}/`;
    const title = `Public Changes — ${ym}`;
    const pubDate = new Date(arr[0]?.date || `${ym}-01`).toUTCString();
    return `<item><title>${esc(title)}</title><link>${link}</link><guid>${link}</guid><pubDate>${pubDate}</pubDate></item>`;
  }).join('');
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>CG Alert · Reports</title>
<link>${ORIGIN}/reports/</link>
<description>Monthly public changes across monitored vendors</description>
${items}
</channel></rss>`;
  fs.writeFileSync(path.join(OUT,'rss.xml'), rss, 'utf8');
}
function writeSitemap(months){
  const urls = months.map(([ym])=>`<url><loc>${ORIGIN}/reports/${ym}/</loc></url>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${ORIGIN}/reports/</loc></url>${urls}</urlset>`;
  fs.writeFileSync(path.join(ROOT,'sitemap-reports.xml'), xml, 'utf8');

  // 合并到 sitemap-index.xml（若存在则增量追加；否则创建一个简单的）
  const idxFile = path.join(ROOT,'sitemap-index.xml');
  const known = ['sitemap-pages.xml','sitemap-vendors.xml','sitemap-updates.xml','sitemap-reports.xml']
    .filter(f=>fs.existsSync(path.join(ROOT,f)));
  const idx = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${known.map(f=>`<sitemap><loc>${ORIGIN}/${f}</loc></sitemap>`).join('\n')}
</sitemapindex>`;
  fs.writeFileSync(idxFile, idx, 'utf8');
}

(function main(){
  const all = readEvidence();
  const months = bucketByMonth(all);
  ensure(OUT);
  if (months.length === 0) {
    fs.writeFileSync(path.join(OUT,'index.html'), '<!doctype html><meta charset="utf-8"><title>Reports</title><div class="wrap"><h1>Reports</h1><p>No reports yet.</p></div>');
    writeRSS([]); writeSitemap([]);
    console.log('reports: empty');
    return;
  }
  writeIndex(months);
  for (const [ym, arr] of months) writeMonth(ym, arr);
  writeRSS(months);
  writeSitemap(months);
  console.log(`reports: index + ${months.length} months built`);
})();
