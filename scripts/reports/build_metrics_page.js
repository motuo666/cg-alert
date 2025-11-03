#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const OUT = path.join('public','reports','metrics','index.html');
const SRC = path.join('reports','metrics','daily.json');
if(!fs.existsSync(SRC)){ console.log('no daily.json, skip'); process.exit(0); }
let data = JSON.parse(fs.readFileSync(SRC,'utf8'));
if(!Array.isArray(data)){ data = Object.keys(data).sort().map(k=>Object.assign({date:k}, data[k])); }
function esc(s){ return String(s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function svgSpark(values, w=200,h=40){
  values = values.map(v=>Number(v||0)); if(values.length<2){ return `<svg width="${w}" height="${h}"></svg>`; }
  const max = Math.max(...values), min = Math.min(...values); const step = (w-6)/(values.length-1);
  const norm = v => h-3 - (max===min?0:(v-min)/(max-min)*(h-10));
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${
    values.map((v,i)=>`${(3+i*step).toFixed(2)},${norm(v).toFixed(2)}`).join(' ')
  }"/></svg>`;
}
const arr = data, dates = arr.map(d=>d.date);
const evid = arr.map(d=>Number(d.evidence24||d.evidence||0));
const sent = arr.map(d=>Number(d.sent24||d.sent||0));
const open = arr.map(d=>Number(d.open24||d.open||0));
const reply= arr.map(d=>Number(d.reply24||d.reply||0));
const bounce= arr.map(d=>Number(d.bounce24||d.bounce||0));
const rows = arr.slice(-30).reverse().map(d=>`<tr>
<td>${esc(d.date)}</td><td>${esc(d.evidence24??d.evidence??'')}</td>
<td>${esc(d.sent24??d.sent??'')}</td><td>${esc(d.open24??d.open??'')}</td>
<td>${esc(d.reply24??d.reply??'')}</td><td>${esc(d.bounce24??d.bounce??'')}</td>
</tr>`).join('');
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CG Alert — Metrics (last 30 days)</title>
<meta name="description" content="Evidence, outreach, opens, replies, and bounces for the last 30 days.">
<link rel="canonical" href="/reports/metrics/">
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#0b1020;color:#e5e9ff}
header{padding:18px 16px;background:#0f1530;border-bottom:1px solid #26314a}h1{font-size:20px;margin:0}
main{max-width:1024px;margin:18px auto;padding:0 16px 48px}.card{background:#121933;border:1px solid #26314a;border-radius:14px;padding:14px 16px;margin:14px 0}
table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #26314a;padding:8px 6px;text-align:right}th:first-child,td:first-child{text-align:left}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}@media (max-width:720px){.grid{grid-template-columns:1fr}}
svg{display:block}.mono{font-variant-numeric:tabular-nums}
</style>
<header><h1>Metrics — last 30 days</h1></header>
<main>
<div class=grid>
  <div class=card><b>Evidence/day</b>${svgSpark(evid)}</div>
  <div class=card><b>Sent/day</b>${svgSpark(sent)}</div>
  <div class=card><b>Open/day</b>${svgSpark(open)}</div>
  <div class=card><b>Reply/day</b>${svgSpark(reply)}</div>
  <div class=card><b>Bounce/day</b>${svgSpark(bounce)}</div>
</div>
<div class=card>
  <table class=mono>
    <thead><tr><th>Date</th><th>Evidence</th><th>Sent</th><th>Open</th><th>Reply</th><th>Bounce</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="opacity:.7;font-size:12px;margin-top:8px">Source: reports/metrics/daily.json</div>
</div>
</main>`;
require('fs').mkdirSync(require('path').dirname(OUT),{recursive:true});
require('fs').writeFileSync(OUT, html); console.log('wrote', OUT);
