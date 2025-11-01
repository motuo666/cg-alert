#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();
const now = new Date();
const y = now.getUTCFullYear(); const m = now.getUTCMonth();
const prev = new Date(Date.UTC(y, m-1, 1));
const period = { y: prev.getUTCFullYear(), m: String(prev.getUTCMonth()+1).padStart(2,'0') };
function readCsv(p){ if(!fs.existsSync(p)) return {head:[], rows:[]}; const L = fs.readFileSync(p,'utf8').trim().split(/\r?\n/); if(!L.length) return {head:[], rows:[]}; const H=L.shift().split(','); const rows=L.map(l=>{const a=l.split(','); const o={}; H.forEach((k,i)=>o[k]=a[i]||''); return o;}); return {head:H, rows}; }
function inPrevMonth(ts){
  const d = new Date(ts); return d.getUTCFullYear()==period.y && String(d.getUTCMonth()+1).padStart(2,'0')==period.m;
}
function countEvidence(){
  const base = path.join(ROOT,'public','evidence'); let cnt=0; const vendors= new Set();
  if (!fs.existsSync(base)) return {cnt:0, vendors:0};
  for(const v of (fs.readdirSync(base)||[])){
    const vd = path.join(base, v); if (!fs.statSync(vd).isDirectory()) continue;
    for(const f of (fs.readdirSync(vd)||[])){
      if (!f.endsWith('.json')) continue;
      const p = path.join(vd,f); const st = fs.statSync(p);
      if (inPrevMonth(st.mtime)) { cnt++; vendors.add(v); }
    }
  }
  return {cnt, vendors: vendors.size};
}
const ev = countEvidence();
const outreach = readCsv(path.join(ROOT,'out','outreach_log.csv')).rows.filter(r=>inPrevMonth(r.at) && r.status==='SENT').length;
const suppress = readCsv(path.join(ROOT,'data','suppressions.csv')).rows.filter(r=>inPrevMonth(r.at)).length;
const orders = readCsv(path.join(ROOT,'data','orders.csv')).rows.filter(r=>inPrevMonth(r.ts)).length;
const html = `<!doctype html><meta charset="utf-8"><title>Monthly Ops — CG Alert</title>
<h1>Monthly Ops Summary — ${period.y}-${period.m}</h1>
<ul>
<li>Evidence files: <b>${ev.cnt}</b> across <b>${ev.vendors}</b> vendors</li>
<li>Outreach sent: <b>${outreach}</b></li>
<li>Suppressions added: <b>${suppress}</b></li>
<li>New orders: <b>${orders}</b></li>
</ul>`;
const dir = path.join(ROOT,'ops','monthly'); require('fs').mkdirSync(dir,{recursive:true});
const file = path.join(dir, `${period.y}-${period.m}.html`);
fs.writeFileSync(file, html);
console.log('monthly report:', file);
