'use strict';
const fs = require('fs'); const path = require('path');
const RAW = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
let ORIGIN = RAW; try { ORIGIN = new URL(RAW).origin; } catch(e) { ORIGIN = 'https://www.cg-alert.com'; }
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const OUT_PATH = path.join(PUBLIC_DIR, 'rss.xml');

function walk(dir, out=[]){ for(const name of fs.readdirSync(dir)){ const p=path.join(dir,name); const st=fs.statSync(p); if(st.isDirectory()) walk(p,out); else out.push(p); } return out; }
function exists(p){ try{ fs.accessSync(p); return true; } catch { return false; } }

function build(){
  const evidenceDir = path.join(PUBLIC_DIR,'evidence');
  const items = [];
  if (exists(evidenceDir)){
    for (const p of walk(evidenceDir)){
      if (!/\.json$/i.test(p)) continue;
      const rel = p.replace(/^[\\s\\S]*?public[\\/]/,'').replace(/\\/g,'/');
      const url = ORIGIN + '/' + rel.replace(/^public\\//,'');
      items.push({ title: rel.split('/').slice(-1)[0], link: url, guid: rel, date: fs.statSync(p).mtime });
    }
  }
  items.sort((a,b)=> b.date - a.date);
  const head = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>CG Alert — Evidence Feed</title>
    <link>${ORIGIN}</link>
    <atom:link href="${ORIGIN}/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Vendor change evidence.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`;
  const body = items.slice(0,100).map(it => [
      '<item>',
      '  <title>'+it.title.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</title>',
      '  <link>'+it.link.replace(/&/g,'&amp;')+'</link>',
      '  <guid isPermaLink="false">'+it.guid.replace(/&/g,'&amp;')+'</guid>',
      '  <pubDate>'+it.date.toUTCString()+'</pubDate>',
      '</item>'
  ].join('\n')).join('\n');
  const tail = '\n  </channel>\n</rss>\n';
  fs.writeFileSync(OUT_PATH, head+'\n'+body+tail, 'utf8');
  console.log('rss built:', OUT_PATH, 'items=', items.length, 'origin=', ORIGIN);
}
build();
