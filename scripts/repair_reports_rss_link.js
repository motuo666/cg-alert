#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
function* htmlFiles(){
  const rep = 'reports'; if(!fs.existsSync(rep)) return;
  for(const ym of fs.readdirSync(rep)){
    const p = path.join(rep, ym);
    if(!/^\d{4}-\d{2}$/.test(ym) || !fs.statSync(p).isDirectory()) continue;
    for(const v of fs.readdirSync(p)){
      const idx = path.join(p, v, 'index.html');
      if(fs.existsSync(idx)) yield idx;
    }
    const monthIdx = path.join(p, 'index.html'); if(fs.existsSync(monthIdx)) yield monthIdx;
  }
  const rootIdx = path.join('reports','index.html'); if(fs.existsSync(rootIdx)) yield rootIdx;
}
let touched = 0;
for(const fp of htmlFiles()){
  let html = fs.readFileSync(fp,'utf8'); const before = html;
  html = html.replace(/href="[^"]*reports\.rss\.xml"/g, 'href="/rss/index.xml"');
  html = html.replace(/href="[^"]*\/reports\/rss\.xml"/g, 'href="/rss/index.xml"');
  if(html !== before){ fs.writeFileSync(fp, html, 'utf8'); touched++; }
}
console.log('repair_reports_rss_link: updated files', touched);
