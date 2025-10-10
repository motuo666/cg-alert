// scripts/build_updates.js — Updates 增强版（可读性&布局收口）
// 读取 evidence/<vendor>/<YYYY-MM-DD>.json → 生成 /updates/index.html 与 /updates/rss.xml
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const EVID=path.join(ROOT,'evidence');
const OUT =path.join(ROOT,'updates');
const SITE=process.env.SITE_ORIGIN||'https://www.cg-alert.com';

const DAY=24*3600*1000, NOW=Date.now(), SINCE=NOW-30*DAY;

const css=`body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fff;color:#111;margin:0}
.wrap{max-width:980px;margin:0 auto;padding:24px 16px}
h1{font-size:26px;margin:0 0 8px}.meta{color:#666;font-size:12px}
.cards{display:grid;grid-template-columns:1fr;gap:12px}
@media(min-width:880px){.cards{grid-template-columns:1fr 1fr}}
.card{border:1px solid #eee;border-radius:14px;padding:12px;background:#fff}
.badge{display:inline-block;border:1px solid #ddd;border-radius:999px;padding:2px 10px;font-size:12px;margin-right:8px;background:#f7f7f7;line-height:20px}
.vendor{font-weight:600;margin-left:2px}
blockquote{background:#fafafa;border:1px solid #eee;border-radius:12px;padding:10px;white-space:pre-wrap;margin:8px 0;max-height:260px;overflow:hidden}
a{color:#0a58ca;text-decoration:none}a:hover{text-decoration:underline}
.nav{margin:6px 0 14px}.small{color:#666;font-size:12px}
.legend{margin:6px 0 10px}.legend .badge{margin:0 6px 6px 0}
.top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.top .left{display:flex;align-items:center;gap:8px}
.top .right{margin-left:auto;text-align:right}
.host a{color:#0a58ca;text-decoration:none;word-break:break-all}`;

function esc(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function ensure(p){fs.mkdirSync(p,{recursive:true});}
function listVendors(){ if(!fs.existsSync(EVID)) return []; return fs.readdirSync(EVID,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);}
function readJSON(fp){ try{const t=fs.readFileSync(fp,'utf8').trim(); if(!t) return []; const j=JSON.parse(t); return Array.isArray(j)?j:[j]; }catch{return [];}}

function guessType(u='',sn=''){
  const s=(u+' '+sn).toLowerCase();
  if(/sub[- ]?processors?/.test(s)) return 'Subprocessors';
  if(/\bdpa\b|data processing addendum/.test(s)) return 'DPA';
  if(/terms|tos|terms of service/.test(s)) return 'ToS';
  if(/pricing|price|plan(s)?/.test(s)) return 'Pricing';
  if(/status|uptime/.test(s)) return 'Status';
  return 'Other';
}

function collect(){
  const rows=[];
  for(const v of listVendors()){
    const dir=path.join(EVID,v);
    if(!fs.existsSync(dir)) continue;
    const files=fs.readdirSync(dir).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f));
    for(const f of files){
      const day=f.replace(/\.json$/,'');
      const ts=new Date(day+'T00:00:00Z').getTime();
      if(ts < SINCE) continue;
      const items=readJSON(path.join(dir,f));
      for(const it of items){
        const url=it.url||it.URL||it.link||'';
        const snippet=String(it.snippet||it.fragment||it.text||'');
        const type=guessType(url,snippet);
        let host=''; try{host=new URL(url).host}catch{}
        rows.push({vendor:v, date:day, ts, url, host, snippet, type});
      }
    }
  }
  rows.sort((a,b)=>b.ts-a.ts);
  return rows;
}

function headCommon(title,desc,url){return `
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc.slice(0,160))}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc.slice(0,200))}">
<meta property="og:type" content="website"><meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${esc(url)}">`; }

function pageHTML(items){
  const url=`${SITE}/updates/`;
  const title='CG Alert — Top Public Changes (30 days)';
  const desc='Top changes across Pricing/ToS/DPA/Subprocessors/Status in the last 30 days, with verifiable evidence snippets.';
  const counts=items.reduce((m,it)=>(m[it.type]=(m[it.type]||0)+1,m),{});
  const legend=`<div class="legend">
  <span class="badge">Pricing ${counts.Pricing||0}</span>
  <span class="badge">ToS ${counts.ToS||0}</span>
  <span class="badge">DPA ${counts.DPA||0}</span>
  <span class="badge">Subprocessors ${counts.Subprocessors||0}</span>
  <span class="badge">Status ${counts.Status||0}</span>
</div>`;
  const cards=items.map(e=>{
    const vendorURL=`${SITE}/vendors/${encodeURIComponent(e.vendor)}/`;
    const hostLink = e.url ? `<a href="${esc(e.url)}" rel="nofollow">${esc(e.host||'source')}</a>` : esc(e.host||'source');
    return `<div class="card">
  <div class="top">
    <div class="left"><span class="badge">${esc(e.type)}</span><a class="vendor" href="${esc(vendorURL)}">${esc(e.vendor)}</a></div>
    <div class="right"><span class="meta">${esc(e.date)}</span></div>
  </div>
  <div class="host">${hostLink}</div>
  <blockquote>${esc(e.snippet).slice(0,1500) || '<em>No snippet</em>'}</blockquote>
</div>`;
  }).join('\n');

  const count=items.length;
  return `<!doctype html><html lang="en"><head>${headCommon(title,desc,url)}<style>${css}</style></head>
<body><div class="wrap">
  <div class="nav"><a href="${esc(SITE)}">← Home</a></div>
  <h1>Top Public Changes</h1>
  <div class="meta">Window: last 30 days · Items: ${count}</div>
  ${legend}
  <div class="cards">${cards || '<div class="meta">No changes in the last 30 days.</div>'}</div>
  <p class="small">We only collect public pages and respect robots.txt. Refund in 30 days if no material alert.</p>
</div></body></html>`;
}

function rssXML(items){
  const last=new Date().toUTCString();
  const head=`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>CG Alert — Top Public Changes</title><link>${esc(SITE+'/updates/')}</link>
<description>Top ${items.length} changes in the last 30 days (public pages: Pricing/ToS/DPA/Subprocessors/Status).</description><lastBuildDate>${last}</lastBuildDate>`;
  const its=items.slice(0,100).map(e=>`<item><title>${esc(e.vendor)} — ${esc(e.date)}</title><link>${esc(e.url)}</link><guid isPermaLink="false">${esc(SITE+'/updates/#'+encodeURIComponent(e.vendor)+'-'+e.date)}</guid><pubDate>${new Date(e.ts).toUTCString()}</pubDate><description><![CDATA[${(e.snippet||'').toString().slice(0,2000)}]]></description></item>`).join('');
  return head+its+'</channel></rss>';
}

(function main(){
  const items=collect();
  fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,'index.html'), pageHTML(items), 'utf8');
  fs.writeFileSync(path.join(OUT,'rss.xml'),  rssXML(items),  'utf8');
  console.log(`updates: built ${items.length} items (30d)`);
})();
