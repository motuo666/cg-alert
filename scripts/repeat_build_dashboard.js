#!/usr/bin/env node
const fs = require('fs'), path = require('path');

function detectBase(fs){
  if (fs.existsSync('cg-alert-main/index.html')) return 'cg-alert-main';
  if (fs.existsSync('index.html')) return '.';
  if (fs.existsSync('cg-alert-main')) return 'cg-alert-main';
  return '.';
}

const BASE = detectBase(fs);
const EVID = path.join(BASE, 'evidence');
function list(){ 
  if(!fs.existsSync(EVID)) return [];
  return fs.readdirSync(EVID).filter(v=>fs.statSync(path.join(EVID,v)).isDirectory())
   .map(v=>{ const vd=path.join(EVID,v); const caps=fs.readdirSync(vd).filter(x=>/\d{4}-\d{2}-\d{2}T/.test(x)).sort(); return caps.length?{vendor:v, latest:caps[caps.length-1]}:null; })
   .filter(Boolean).sort((a,b)=>a.vendor.localeCompare(b.vendor));
}
function html(rows){
  const rowsHtml = rows.map(r=>`<tr><td>${r.vendor}</td><td><a href="/evidence/${encodeURIComponent(r.vendor)}/${encodeURIComponent(r.latest)}/index0.html">${r.latest}</a></td></tr>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CG Alert — Evidence Dashboard</title></head><body>
<main class="wrap"><h1>Evidence Dashboard</h1>
<p class="muted">Latest captures by vendor (from <code>/evidence</code>).</p>
<table><thead><tr><th>Vendor</th><th>Latest</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</main></body></html>`;
}
const rows = list();
const OUT = path.join(BASE, 'dashboard'); fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'index.html'), html(rows),'utf8');
console.log('dashboard built with rows:', rows.length);
