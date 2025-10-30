#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const root = 'evidence';
function list(){
  if(!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(v=>{
    const p = path.join(root, v);
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  }).map(v=>{
    const caps = fs.readdirSync(path.join(root,v)).filter(x=>/\d{4}-\d{2}-\d{2}T/.test(x)).sort();
    return caps.length ? {vendor:v, latest:caps[caps.length-1]} : null;
  }).filter(Boolean).sort((a,b)=>a.vendor.localeCompare(b.vendor));
}
function html(rows){
  const rowsHtml = rows.map(r=>`<tr><td>${r.vendor}</td><td><a href="/evidence/${encodeURIComponent(r.vendor)}/${encodeURIComponent(r.latest)}/index0.html">${r.latest}</a></td></tr>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CG Alert — Evidence Dashboard</title></head><body>
<main class="wrap"><h1>Evidence Dashboard</h1>
<p class="muted">Latest captures by vendor (from <code>/evidence</code>).</p>
<table><thead><tr><th>Vendor</th><th>Latest</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</main>
</body></html>`;
}
const rows = list();
fs.mkdirSync('dashboard', {recursive:true});
fs.writeFileSync(path.join('dashboard','index.html'), html(rows), 'utf8');
console.log('dashboard built with rows:', rows.length);
