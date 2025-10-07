// scripts/build_updates.js
const fs = require('fs'); const path = require('path');
const EVID_DIR = path.join(__dirname, '..', 'evidence');
const OUT_DIR  = path.join(__dirname, '..', 'updates');
const DAYS  = Number(process.env.UPDATES_DAYS  || 30);
const LIMIT = Number(process.env.UPDATES_LIMIT || 10);
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
function ensureDir(p){ fs.mkdirSync(p,{recursive:true}); }
function iso(d){ return new Date(d).toISOString(); }
function toRssDate(d){ return new Date(d).toUTCString(); }
function h(s=''){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function x(s=''){ return h(s); }
function readJsonSafe(fp){ try{ const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return null; return JSON.parse(raw); }catch{ return null; } }
function* iterEvidence(){
  if (!fs.existsSync(EVID_DIR)) return;
  const vendors = fs.readdirSync(EVID_DIR,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
  for (const vendor of vendors){
    const vdir=path.join(EVID_DIR,vendor);
    const files=fs.readdirSync(vdir,{withFileTypes:true}).filter(f=>f.isFile()&&f.name.toLowerCase().endsWith('.json')).map(f=>f.name);
    for (const fname of files){
      const dateStr=fname.replace(/\.json$/i,''); const j=readJsonSafe(path.join(vdir,fname)); if(!j) continue;
      const items = Array.isArray(j)?j:[j]; let idx=0;
      for (const it of items){
        const url=it.url||it.URL||it.link||''; const snippet=it.snippet||it.fragment||it.text||''; const hash=it.hash||it.etag||'';
        const ts=it.timestamp||it.ts||`${dateStr}T00:00:00Z`; const when=new Date(ts); if(isNaN(when.getTime())) continue;
        yield { vendor, dateStr, url, snippet, hash, ts: when.toISOString(), anchor:`${vendor}-${dateStr}-${idx++}`.toLowerCase().replace(/[^a-z0-9\-]/g,'-') };
      }
    }
  }
}
function pickRecent(items){ const cutoff=Date.now()-DAYS*24*3600*1000; return items.filter(x=>new Date(x.ts).getTime()>=cutoff).sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,LIMIT); }
function renderHTML(items, builtAtIso){
  const list = items.map(it=>{
    let host=''; try{ host=new URL(it.url).host; }catch{}
    const text = h((it.snippet||'').trim()).slice(0,1200);
    return `
    <li id="${it.anchor}">
      <h3 class="item-title">${h(it.vendor)} — ${h(it.dateStr)}</h3>
      <p class="meta">
        <a href="${h(it.url)}" rel="nofollow">Source (${h(host)})</a>
        <span>· Timestamp: ${h(it.ts)}</span>
        ${it.hash?`<span>· Hash: <code>${h(String(it.hash)).slice(0,16)}…</code></span>`:''}
      </p>
      <blockquote class="snippet">${text || '<em>No snippet</em>'}</blockquote>
      <p class="permalink"><a href="#${it.anchor}">Permalink</a></p>
    </li>`; }).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CG Alert · Top Public Changes (Last ${DAYS} Days)</title>
<link rel="alternate" type="application/rss+xml" title="CG Alert Updates" href="${SITE_ORIGIN}/updates/rss.xml" />
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fff;color:#111;margin:0;padding:24px 16px;line-height:1.5}
.wrap{max-width:880px;margin:0 auto} h1{font-size:28px;margin:0 0 8px} .meta{color:#666;font-size:14px}
ol{padding-left:20px} li{margin:18px 0 28px} .item-title{margin:0 0 6px}
.snippet{background:#fafafa;border:1px solid #eee;border-radius:12px;padding:12px;white-space:pre-wrap}
code{background:#f5f5f5;padding:2px 4px;border-radius:6px}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
a{color:#0a58ca;text-decoration:none} a:hover{text-decoration:underline}
</style>
<div class="wrap">
  <div class="topbar"><h1>Top Public Changes <small style="font-size:14px;color:#666">(${DAYS} days)</small></h1><a href="${SITE_ORIGIN}/updates/rss.xml">RSS</a></div>
  <p class="meta">Built at ${h(builtAtIso)} · Items: ${items.length}</p>
  <ol>${list || '<li><em>No recent public changes in the last '+DAYS+' days.</em></li>'}</ol>
</div></html>`;
}
function renderRSS(items, builtAtIso){
  const channelTitle='CG Alert — Top Public Changes'; const channelLink=`${SITE_ORIGIN}/updates/`;
  const channelDesc=`Top ${items.length} changes in the last ${DAYS} days (public pages: Pricing/ToS/DPA/Subprocessors/Status).`;
  const rssItems=items.map(it=>{
    const title=x(`${it.vendor} — ${it.dateStr}`); const link=x(it.url||channelLink); const guid=x(`${SITE_ORIGIN}/updates/#${it.anchor}`);
    const desc='<![CDATA['+(it.snippet?it.snippet.toString().slice(0,2000):'No snippet')+']]>';
    return `<item><title>${title}</title><link>${link}</link><guid isPermaLink="false">${guid}</guid><pubDate>${toRssDate(it.ts)}</pubDate><description>${desc}</description></item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>${x(channelTitle)}</title><link>${x(channelLink)}</link><description>${x(channelDesc)}</description>
<lastBuildDate>${toRssDate(builtAtIso)}</lastBuildDate>${rssItems}</channel></rss>`;
}
function main(){ fs.mkdirSync(OUT_DIR,{recursive:true}); const all=Array.from(iterEvidence()); const picked=pickRecent(all);
  const builtAtIso=iso(new Date()); const html=renderHTML(picked, builtAtIso); const rss=renderRSS(picked, builtAtIso);
  fs.writeFileSync(path.join(OUT_DIR,'index.html'), html,'utf8'); fs.writeFileSync(path.join(OUT_DIR,'rss.xml'), rss,'utf8');
  console.log(`build_updates: wrote ${picked.length} items → updates/index.html & rss.xml`);
}
main();
