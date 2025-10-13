#!/usr/bin/env node
/**
 * build_public_monthly.js — 生成 /reports/<YYYY-MM>/ 与 /reports/index.html 和 /reports/rss.xml
 * source: evidence/<vendor>/<YYYY-MM-DD>*.json (mtime 作为 last changed)
 */
const fs=require('fs'), path=require('path');

function ym(d=new Date()){ return d.toISOString().slice(0,7); }
function listMonth(ymStr){
  const base='evidence', items=[];
  if(!fs.existsSync(base)) return items;
  for(const d of fs.readdirSync(base,{withFileTypes:true})){
    if(!d.isDirectory()) continue; const slug=d.name; const dir=path.join(base,slug);
    for(const f of fs.readdirSync(dir)){
      const m=f.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})-(.+)\.json$/i); if(!m) continue;
      if(m[1].slice(0,7)!==ymStr) continue;
      const p=path.join(dir,f); const st=fs.statSync(p);
      items.push({ slug, date: m[1], file:f, ts: st.mtime });
    }
  }
  items.sort((a,b)=> b.ts-a.ts);
  return items;
}
function ensure(p){ fs.mkdirSync(p,{recursive:true}); }
function writeMonthPage(ymStr, items){
  ensure(path.join('reports', ymStr));
  const list = items.map(it=>`<li>${it.date} · ${it.slug}</li>`).join('\n') || '<li>No items.</li>';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CG Alert — ${ymStr}</title>
<meta name="description" content="Evidence-backed public changes in ${ymStr}.">
<link rel="canonical" href="https://www.cg-alert.com/reports/${ymStr}/"></head>
<body><div class="wrap"><h1>Public Changes — ${ymStr}</h1><ul>${list}</ul></div></body></html>`;
  fs.writeFileSync(path.join('reports', ymStr, 'index.html'), html, 'utf8');
}
function writeIndex(latestYM){
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Reports — CG Alert</title>
<meta name="description" content="Monthly evidence-backed public changes.">
<link rel="canonical" href="https://www.cg-alert.com/reports/">
<link rel="alternate" type="application/rss+xml" title="CG Alert Reports RSS" href="https://www.cg-alert.com/reports/rss.xml"></head>
<body><div class="wrap"><h1>Reports</h1><p>Latest: <a href="/reports/${latestYM}/">${latestYM}</a></p></div></body></html>`;
  ensure('reports'); fs.writeFileSync(path.join('reports','index.html'), html, 'utf8');
}
function writeRSS(items){
  const itemsXml = items.slice(0,50).map(it=>`<item><title>${it.date} · ${it.slug}</title><link>https://www.cg-alert.com/vendors/${encodeURIComponent(it.slug)}/</link></item>`).join('');
  const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>CG Alert Reports</title><link>https://www.cg-alert.com/reports/</link>${itemsXml}</channel></rss>`;
  fs.writeFileSync(path.join('reports','rss.xml'), rss, 'utf8');
}

(function main(){
  const ymStr = process.env.MONTH || ym();
  const items = listMonth(ymStr);
  writeMonthPage(ymStr, items);
  writeIndex(ymStr);
  writeRSS(items);
  console.log('[reports] built', ymStr, 'items=', items.length);
})();
