// scripts/build_categories.js
// 从 data/vendor_tags.csv + evidence/<vendor>/*.json 生成：/categories/* 与 sitemap-categories.xml
const fs = require('fs'); const path = require('path');
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const EVID = path.join(__dirname,'..','evidence');
const OUT = path.join(__dirname,'..','categories');
const TAGS_CSV = path.join(__dirname,'..','data','vendor_tags.csv');
function esc(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function ensureDir(p){fs.mkdirSync(p,{recursive:true});}
function readCSV(fp){
  if(!fs.existsSync(fp)) return [];
  const rows = fs.readFileSync(fp,'utf8').trim().split(/\r?\n/); if(rows.length<=1) return [];
  const [h,...rest]=rows; const keys=h.split(',').map(x=>x.trim());
  return rest.filter(Boolean).map(line=>{
    const vals=line.split(','); const o={}; keys.forEach((k,i)=>o[k]=String(vals[i]||'').trim()); return o;
  });
}
function j(fp){try{const t=fs.readFileSync(fp,'utf8').trim(); if(!t) return null; return JSON.parse(t);}catch{return null;}}
function latestByVendor(){
  const out={}; if(!fs.existsSync(EVID)) return out;
  const vendors=fs.readdirSync(EVID,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
  for(const v of vendors){
    const files=fs.readdirSync(path.join(EVID,v)).filter(f=>f.endsWith('.json'));
    let best=null;
    for(const f of files){
      const date=f.replace(/\.json$/,'');
      const obj=j(path.join(EVID,v,f)); if(!obj) continue;
      const arr=Array.isArray(obj)?obj:[obj];
      for(const it of arr){
        const ts=new Date(it.timestamp||it.ts||(`${date}T00:00:00Z`));
        const url=it.url||it.URL||it.link||''; const snippet=it.snippet||it.fragment||it.text||'';
        if(!best || ts>new Date(best.ts)) best={vendor:v,ts:ts.toISOString(),url,snippet};
      }
    }
    if(best) out[v]=best;
  }
  return out;
}
function pageTag(tag, items){
  const list = items.map(x=>{
    let host=''; try{host=new URL(x.url).host;}catch{}
    return `<li>
      <a href="${esc(`${SITE}/vendors/${encodeURIComponent(x.vendor)}/`)}"><strong>${esc(x.vendor)}</strong></a>
      <span class="meta">${esc(x.ts)}</span>
      <div class="src"><a href="${esc(x.url)}" rel="nofollow">来源 ${esc(host)}</a></div>
      <blockquote>${esc((x.snippet||'').trim()).slice(0,800) || '<em>No snippet</em>'}</blockquote>
    </li>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Category: ${esc(tag)} · CG Alert</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fff;color:#111;margin:0}
.wrap{max-width:960px;margin:0 auto;padding:24px 16px}
h1{font-size:26px;margin:0 0 10px}
ul{list-style:none;padding:0;margin:12px 0}
li{border:1px solid #eee;border-radius:14px;padding:12px;margin:12px 0;background:#fff}
.meta{float:right;color:#666;font-size:12px}
.src{margin:6px 0 4px}
blockquote{background:#fafafa;border:1px solid #eee;border-radius:12px;padding:10px;white-space:pre-wrap;margin:8px 0}
a{color:#0a58ca;text-decoration:none} a:hover{text-decoration:underline}
</style>
<div class="wrap">
  <h1>Category: ${esc(tag)}</h1>
  <ul>${list || '<li><em>No vendors</em></li>'}</ul>
</div></html>`;
}
function pageIndex(groups){
  const rows = Object.keys(groups).sort().map(tag=>{
    const n=groups[tag].length;
    return `<li><a href="${esc(`${SITE}/categories/${encodeURIComponent(tag)}/`)}">${esc(tag)}</a><span class="meta">${n} vendors</span></li>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Categories · CG Alert</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fff;color:#111;margin:0}
.wrap{max-width:720px;margin:0 auto;padding:24px 16px}
h1{font-size:26px;margin:0 0 10px}
ul{list-style:none;padding:0;margin:12px 0}
li{border-bottom:1px solid #eee;padding:10px 2px;display:flex;gap:10px;align-items:center}
li .meta{margin-left:auto;color:#666;font-size:12px}
a{color:#0a58ca;text-decoration:none} a:hover{text-decoration:underline}
</style>
<div class="wrap">
  <h1>Categories</h1>
  <ul>${rows || '<li><em>No categories</em></li>'}</ul>
</div></html>`;
}
function main(){
  const latest=latestByVendor();
  const tagRows=readCSV(TAGS_CSV);
  const groups={};
  for(const r of tagRows){
    if(!r.vendor || !r.tag) continue;
    const v=r.vendor.trim(); const tag=r.tag.trim().toLowerCase();
    if(!latest[v]) continue;
    (groups[tag]=groups[tag]||[]).push({ vendor:v, ...latest[v] });
  }
  ensureDir(OUT);
  for(const [tag, items] of Object.entries(groups)){
    const dir=path.join(OUT, tag); ensureDir(dir);
    fs.writeFileSync(path.join(dir,'index.html'), pageTag(tag, items.sort((a,b)=>b.ts.localeCompare(a.ts))), 'utf8');
  }
  fs.writeFileSync(path.join(OUT,'index.html'), pageIndex(groups), 'utf8');
  const urls = Object.keys(groups).sort().map(tag=>`  <url><loc>${esc(`${SITE}/categories/${encodeURIComponent(tag)}/`)}</loc></url>`).join('\n');
  const sm = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  fs.writeFileSync(path.join(__dirname,'..','sitemap-categories.xml'), sm, 'utf8');
  console.log(`categories: tags=${Object.keys(groups).length}`);
}
main();
