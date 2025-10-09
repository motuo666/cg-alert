const fs=require('fs'),path=require('path');const SITE=process.env.SITE_ORIGIN||'https://www.cg-alert.com';
const ROOT=path.join(__dirname,'..'),EVID=path.join(ROOT,'evidence'),OUT=path.join(ROOT,'vendors'),API=path.join(ROOT,'api');
const esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const ensure=p=>fs.mkdirSync(p,{recursive:true});
const readJ=fp=>{try{const t=fs.readFileSync(fp,'utf8').trim();if(!t)return[];const j=JSON.parse(t);return Array.isArray(j)?j:[j]}catch{return[]}};
const listV=()=>fs.existsSync(EVID)?fs.readdirSync(EVID,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name):[];
const load=(vendor)=>{const dir=path.join(EVID,vendor);if(!fs.existsSync(dir))return[];return fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort().flatMap(f=>{
  const date=f.replace(/\.json$/,'');return readJ(path.join(dir,f)).map(it=>({vendor,ts:new Date(it.timestamp||it.ts||(`${date}T00:00:00Z`)).toISOString(),url:it.url||it.URL||it.link||'',snippet:(it.snippet||it.fragment||it.text||'').toString()}));
}).sort((a,b)=>b.ts.localeCompare(a.ts));};

const css=`body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fff;color:#111;margin:0}
.wrap{max-width:960px;margin:0 auto;padding:24px 16px}h1{font-size:26px;margin:0 0 8px}
ul{list-style:none;padding:0;margin:12px 0}li{border:1px solid #eee;border-radius:14px;padding:12px;margin:12px 0;background:#fff}
.meta{float:right;color:#666;font-size:12px}blockquote{background:#fafafa;border:1px solid #eee;border-radius:12px;padding:10px;white-space:pre-wrap;margin:8px 0}
a{color:#0a58ca;text-decoration:none}a:hover{text-decoration:underline}.nav{margin:6px 0 14px}.btn{display:inline-block;padding:8px 12px;border:1px solid #ddd;border-radius:10px;background:#f7f7f7}
.small{color:#666;font-size:12px}`;

function headCommon(title,desc,url){return `
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc.slice(0,160))}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc.slice(0,200))}">
<meta property="og:type" content="website"><meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${esc(url)}">`; }

function vendorHTML(vendor,rows){
  const items=rows.map(e=>{let host='';try{host=new URL(e.url).host}catch{}return `<li><span class="meta">${esc(e.ts)}</span><div><a href="${esc(e.url)}" rel="nofollow">${esc(host||'source')}</a></div><blockquote>${esc(e.snippet).slice(0,1500)||'<em>No snippet</em>'}</blockquote></li>`}).join('\n');
  const url=`${SITE}/vendors/${encodeURIComponent(vendor)}/`; const title=`${vendor} · CG Alert`;
  const desc=`Recent evidence for ${vendor}. Proof-backed changes on Pricing/ToS/DPA/Subprocessors/Status.`;
  const ld=JSON.stringify({"@context":"https://schema.org","@type":"CollectionPage","name":title,"url":url,"about":vendor,"hasPart":rows.slice(0,10).map(r=>({"@type":"CreativeWork","datePublished":r.ts,"url":r.url}))});
  const sub=`mailto:subscribe@cg-alert.com?subject=Subscribe%20${encodeURIComponent(vendor)}&body=Please%20subscribe%20me%20to%20${encodeURIComponent(vendor)}%20updates.`;
  return `<!doctype html><html lang="en"><head>${headCommon(title,desc,url)}
<link rel="alternate" type="application/rss+xml" title="${esc(vendor)} feed" href="${esc(url+'feed.xml')}">
<script type="application/ld+json">${ld}</script>
<style>${css}</style></head><body><div class="wrap">
  <div class="nav"><a href="${esc(`${SITE}/vendors/`)}">← All vendors</a></div>
  <h1>${esc(vendor)}</h1>
  <p><a class="btn" href="${esc(sub)}" target="_blank" rel="noopener">关注此供应商（邮件订阅）</a> <span class="small">纯文本邮件，随时可退订</span></p>
  <ul>${items||'<li><em>No evidence</em></li>'}</ul></div></body></html>`; }

function indexHTML(summary){
  const lis=summary.map(r=>`<li><a href="${esc(`${SITE}/vendors/${encodeURIComponent(r.vendor)}/`)}"><strong>${esc(r.vendor)}</strong></a><span class="meta">${esc(r.last_ts||'')}</span><span style="margin-left:8px;color:#666;font-size:12px">${r.count} updates</span></li>`).join('\n');
  const url=`${SITE}/vendors/`,title='Vendors · CG Alert',desc='Vendor evidence catalog';
  return `<!doctype html><html lang="en"><head>${headCommon(title,desc,url)}<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fff;color:#111;margin:0}
.wrap{max-width:720px;margin:0 auto;padding:24px 16px}h1{font-size:26px;margin:0 0 8px}
ul{list-style:none;padding:0;margin:12px 0}li{border-bottom:1px solid #eee;padding:10px 2px;display:flex;gap:10px;align-items:center}
li .meta{margin-left:auto;color:#666;font-size:12px}a{color:#0a58ca;text-decoration:none}a:hover{text-decoration:underline}
</style></head><body><div class="wrap"><h1>Vendors</h1><ul>${lis||'<li><em>No vendors</em></li>'}</ul></div></body></html>`; }

const vendorRSS=(vendor,rows)=>{const items=rows.slice(0,30).map(e=>`<item><title>${esc(vendor)} update</title><link>${esc(e.url||`${SITE}/vendors/${encodeURIComponent(vendor)}/`)}</link><pubDate>${new Date(e.ts).toUTCString()}</pubDate><guid isPermaLink="false">${esc(vendor)}::${esc(e.ts)}</guid><description><![CDATA[${(e.snippet||'').toString().slice(0,2000)}]]></description></item>`).join('\n');
  const url=`${SITE}/vendors/${encodeURIComponent(vendor)}/`;return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(vendor)} · CG Alert</title><link>${esc(url)}</link><description>Recent evidence for ${esc(vendor)}</description>${items}</channel></rss>`;}

function main(){
  const vendors=listV(); const summary=[];
  for(const v of vendors){
    const rows=load(v); if(rows.length===0) continue;
    const dir=path.join(OUT,v); ensure(dir);
    fs.writeFileSync(path.join(dir,'index.html'),vendorHTML(v,rows),'utf8');
    fs.writeFileSync(path.join(dir,'feed.xml'),vendorRSS(v,rows),'utf8');
    summary.push({vendor:v,last_ts:rows[0].ts,count:rows.length,url:`${SITE}/vendors/${encodeURIComponent(v)}/`});
  }
  summary.sort((a,b)=>(b.last_ts||'').localeCompare(a.last_ts||''));
  ensure(OUT); ensure(API);
  fs.writeFileSync(path.join(OUT,'index.html'),indexHTML(summary),'utf8');
  fs.writeFileSync(path.join(API,'vendors.json'),JSON.stringify(summary,null,2),'utf8');
  fs.writeFileSync(path.join(ROOT,'sitemap-vendors.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${summary.map(r=>`  <url><loc>${esc(r.url)}</loc></url>`).join('\n')}\n</urlset>\n`,'utf8');
  console.log(`vendor_catalog: vendors=${summary.length}`);
}
main();
