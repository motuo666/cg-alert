#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const CANON = 'https://www.cg-alert.com/';
const header = fs.readFileSync(path.join('partials','header.html'),'utf8');
const footer = fs.readFileSync(path.join('partials','footer.html'),'utf8');
const headAdd = `
<link rel="stylesheet" href="/assets/cg.css">
<link rel="alternate" type="application/rss+xml" title="CG Alert Reports" href="/reports/rss.xml">
<link rel="canonical" href="${CANON}">
`;

function walk(p){
  for(const name of fs.readdirSync(p)){
    const fp = path.join(p,name);
    if(name.startsWith('.') || name==='node_modules' || name==='.git' || name==='assets') continue;
    const st = fs.statSync(fp);
    if(st.isDirectory()) walk(fp);
    else if(/\.html$/i.test(name)) {
      let html = fs.readFileSync(fp,'utf8');
      if(!/\/assets\/cg\.css/.test(html)){
        html = html.replace(/<head(.*?)>/i, (m)=> m + headAdd);
      }
      if(!/<header[\\s>]/i.test(html)){
        html = html.replace(/<body(.*?)>/i, (m)=> m + "\\n" + header);
      }
      if(!/<footer[\\s>]/i.test(html)){
        html = html.replace(/<\\/body>/i, footer + "\\n</body>");
      }
      fs.writeFileSync(fp, html, 'utf8');
    }
  }
}
walk('.');
console.log('apply_theme(light): updated files');
