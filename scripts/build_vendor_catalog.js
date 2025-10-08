// scripts/build_vendor_catalog.js
// 生成：vendors/ 供应商档案、api/vendors.json、每供应商 feed.xml、sitemap-vendors.xml
const fs = require('fs'); const path = require('path');
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const ROOT = path.join(__dirname, '..');
const EVID = path.join(ROOT, 'evidence');
const OUT_DIR = path.join(ROOT, 'vendors');
const API_DIR = path.join(ROOT, 'api');
function esc(s=''){return String(s).replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));}
function ensureDir(p){fs.mkdirSync(p,{recursive:true});}
function readJSON(fp){try{const t=fs.readFileSync(fp,'utf8').trim(); if(!t) return []; const j=JSON.parse(t); return Array.isArray(j)?j:[j];}catch{return [];}}
function listVendors(){ if(!fs.existsSync(EVID)) return []; return fs.readdirSync(EVID,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name); }
function loadEntries(vendor){
  const dir = path.join(EVID, vendor);
  if(!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort();
  const out=[];
  for(const f of files){
    const date=f.replace(/\.json$/,'');
    const rows=readJSON(path.join(dir,f));
    for(const it of rows){
      const ts = new Date(it.timestamp || it.ts || `${date}T00:00:00Z`).toISOString();
      out.push({
        vendor, ts,
        url: it.url || it.URL || it.link || '',
        snippet: (it.snippet || it.fragment || it.text || '').toString()
      });
    }
  }
  // 新到旧
  return out.sort((a,b)=> b.ts.localeCompare(a.ts));
}
function renderVendorHTML(vendor, entries){
  const items = entries.map(e=>{
    let host=''; try{host=new URL(e.url).host;}catch{}
    return `<li>
      <span class="meta">${esc(e.ts)}</span>
      <div><a href="${esc(e.url)}" rel="nofollow">${esc(host||'source')}</a></div>
      <blockquote>${esc(e.snippet).slice(0,1200) || '<em>No snippet</em>'}</blockquote>
    </li>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(vendor)} · CG Alert</title>
<link rel="alternate" type="application/rss+xml" title="${esc(vendor)} feed" href="${esc(`${SITE}/vendors/${encodeURIComponent(vendor)}/feed.xml`)}">
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fff;color:#111;margin:0}
.wrap{max-width:960px;margin:0 auto;padding:24px 16px}
h1{font-size:26px;margin:0 0 8px}
ul{list-style:none;padding:0;margin:12px 0}
li{border:1px solid #eee;border-radius:14px;padding:12px;margin:12px 0;background:#fff}
.meta{float:right;color:#666;font-size:12px}
blockquote{background:#fafafa;border:1px solid #eee;border-radius:12px;padding:10px;white-space:pre-wrap;margin:8px 0}
a{color:#0a58ca;text-decoration:none} a:hover{text-decoration:underline}
.nav{margin:6px 0 14px}
</style>
<div class="wrap">
  <div class="nav"><a href="${esc(`${SITE}/vendors/`)}">← All vendors</a></div>
  <h1>${esc(vendor)}</h1>
  <ul>${items || '<li><em>No evidence</em></li>'}</ul>
</div></html>`;
}
function renderIndexHTML(rows){
  const lis = rows.map(r=>{
    return `<li>
      <a href="${esc(`${SITE}/vendors/${encodeURIComponent(r.vendor)}/`)}"><strong>${esc(r.vendor)}</strong></a>
      <span class="meta">${esc(r.last_ts||'')}</span>
      <span style="margin-left:8px;color:#666;font-size:12px">${r.count} updates</span>
    </li>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vendors · CG Alert</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fff;color:#111;margin:0}
.wrap{max-width:720px;margin:0 auto;padding:24px 16px}
h1{font-size:26px;margin:0 0 8px}
ul{list-style:none;padding:0;margin:12px 0}
li{border-bottom:1px solid #eee;padding:10px 2px;display:flex;gap:10px;align-items:center}
li .meta{margin-left:auto;color:#666;font-size:12px}
a{color:#0a58ca;text-decoration:none} a:hover{text-decoration:underline}
</style>
<div class="wrap">
  <h1>Vendors</h1>
  <ul>${lis || '<li><em>No vendors</em></li>'}</ul>
</div></html>`;
}
function renderVendorRSS(vendor, entries){
  const items = entries.slice(0,30).map(e=>{
    return `<item>
      <title>${esc(vendor)} update</title>
      <link>${esc(e.url||`${SITE}/vendors/${encodeURIComponent(vendor)}/`)}</link>
      <pubDate>${new Date(e.ts).toUTCString()}</pubDate>
      <guid isPermaLink="false">${esc(vendor)}::${esc(e.ts)}</guid>
      <description><![CDATA[${(e.snippet||'').toString().slice(0,2000)}]]></description>
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${esc(vendor)} · CG Alert</title>
  <link>${esc(`${SITE}/vendors/${encodeURIComponent(vendor)}/`)}</link>
  <description>Recent evidence for ${esc(vendor)}</description>
  ${items}
</channel></rss>`;
}
function main(){
  const vendors = listVendors();
  ensureDir(OUT_DIR); ensureDir(API_DIR);
  const summary=[];
  for(const v of vendors){
    const entries = loadEntries(v);
    if(entries.length===0) continue;
    const dir = path.join(OUT_DIR, v); ensureDir(dir);
    fs.writeFileSync(path.join(dir,'index.html'), renderVendorHTML(v, entries), 'utf8');
    fs.writeFileSync(path.join(dir,'feed.xml'), renderVendorRSS(v, entries), 'utf8');
    summary.push({ vendor: v, last_ts: entries[0].ts, count: entries.length, url: `${SITE}/vendors/${encodeURIComponent(v)}/` });
  }
  // index + api
  summary.sort((a,b)=> (b.last_ts||'').localeCompare(a.last_ts||''));
  fs.writeFileSync(path.join(OUT_DIR,'index.html'), renderIndexHTML(summary), 'utf8');
  fs.writeFileSync(path.join(API_DIR,'vendors.json'), JSON.stringify(summary, null, 2), 'utf8');
  // sitemap
  const urls = summary.map(r=>`  <url><loc>${esc(r.url)}</loc></url>`).join('\n');
  const sm = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT,'sitemap-vendors.xml'), sm, 'utf8');
  console.log(`vendor_catalog: vendors=${summary.length}`);
}
main();
