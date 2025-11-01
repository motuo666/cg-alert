#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();
const now = new Date(); const ms7 = 7*24*3600*1000; const start = new Date(now.getTime()-ms7);
function readCsv(p){
  if(!fs.existsSync(p)) return {head:[], rows:[]};
  const L = fs.readFileSync(p,'utf8').trim().split(/\r?\n/); if (!L.length) return {head:[], rows:[]};
  const H = L.shift().split(','); const rows = L.map(l=>{const a=l.split(','); const o={}; H.forEach((k,i)=>o[k]=a[i]||''); return o;});
  return {head:H, rows};
}
function ls(dir){ try{ return fs.readdirSync(dir); } catch{ return []; } }
function countEvidence(){
  const base = path.join(ROOT,'public','evidence'); let cnt=0; const vendors= new Set();
  if (!fs.existsSync(base)) return {cnt:0, vendors:0};
  for(const v of ls(base)){
    const vd = path.join(base, v);
    if (!fs.statSync(vd).isDirectory()) continue;
    for(const f of ls(vd)){
      if (!f.endsWith('.json')) continue;
      const p = path.join(vd,f); const st = fs.statSync(p);
      if (st.mtime >= start) { cnt++; vendors.add(v); }
    }
  }
  return {cnt, vendors: vendors.size};
}
const ev = countEvidence();
const outreach = readCsv(path.join(ROOT,'out','outreach_log.csv')).rows.filter(r=>r.status==='SENT' && new Date(r.at)>=start).length;
const suppress = readCsv(path.join(ROOT,'data','suppressions.csv')).rows.filter(r=>new Date(r.at)>=start).length;
const orders = readCsv(path.join(ROOT,'data','orders.csv')).rows.filter(r=>new Date(r.ts)>=start).length;
const html = `<!doctype html><meta charset="utf-8"><title>Weekly Ops — CG Alert</title>
<h1>Weekly Ops Summary</h1>
<p>Window: ${start.toISOString()} → ${now.toISOString()}</p>
<ul>
<li>Evidence files: <b>${ev.cnt}</b> across <b>${ev.vendors}</b> vendors</li>
<li>Outreach sent: <b>${outreach}</b></li>
<li>Suppressions added: <b>${suppress}</b></li>
<li>New orders: <b>${orders}</b></li>
</ul>`;
const dir = path.join(ROOT,'ops','weekly'); fs.mkdirSync(dir,{recursive:true});
const y = now.getUTCFullYear(); const oneJan = new Date(Date.UTC(y,0,1)); const week = Math.ceil((((now - oneJan) / 86400000) + oneJan.getUTCDay()+1) / 7);
const file = path.join(dir, `${y}-W${String(week).padStart(2,'0')}.html`);
fs.writeFileSync(file, html);
console.log('weekly report:', file);
