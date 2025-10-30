#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
function listEvidence(){
  const root = 'evidence';
  if(!fs.existsSync(root)) return [];
  const vendors = fs.readdirSync(root).filter(v=>fs.statSync(path.join(root,v)).isDirectory());
  const rows = [];
  for(const v of vendors){
    const caps = fs.readdirSync(path.join(root,v)).filter(x=>/\d{4}-\d{2}-\d{2}T/.test(x)).sort();
    if(caps.length){
      rows.push({vendor:v, latest:caps[caps.length-1]});
    }
  }
  return rows.sort((a,b)=>a.vendor.localeCompare(b.vendor));
}
function page(rows){
  const items = rows.map(r=>`<tr><td>${r.vendor}</td><td><a href="/evidence/${encodeURIComponent(r.vendor)}/${encodeURIComponent(r.latest)}/index0.html">${r.latest}</a></td></tr>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dashboard — CG Alert</title><link rel="stylesheet" href="/styles.css"></head>
<body>
<header class="site"><div class="wrap bar"><a class="brand" href="/">CG Alert</a><nav><a href="/reports/">Reports</a><a href="/who-uses/">Who Uses</a><a href="/dashboard/">Dashboard</a><a href="/rss.xml">RSS</a></nav></div></header>
<main class="wrap"><h1>Evidence Dashboard</h1>
<p class="muted">Latest capture per vendor</p>
<table><thead><tr><th>Vendor</th><th>Latest</th></tr></thead><tbody>${items}</tbody></table>
</main>
<footer class="site"><div class="wrap muted">© CG Alert</div></footer>
</body></html>`;
}
const rows = listEvidence();
fs.mkdirSync('dashboard', { recursive: true });
fs.writeFileSync(path.join('dashboard','index.html'), page(rows), 'utf8');
console.log('dashboard built:', rows.length);
