#!/usr/bin/env node
/**
* 读取 data/evidence.ndx → 为最近90天高频 vendor 生成 Change Pack
* 输出：/reports/<YYYY-MM>/<vendor>/index.html（What/So/Now 三段 + 证据表）
* 不调用外部API；纯静态HTML
*/
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const NDX = path.join(ROOT, 'data', 'evidence.ndx');
const REPORT_ROOT = path.join(ROOT, 'reports');
const NOW = new Date();
const Y = NOW.getUTCFullYear();
const M = String(NOW.getUTCMonth()+1).padStart(2,'0');
const CUR = `${Y}-${M}`;


function readNDX(){
if (!fs.existsSync(NDX)) return [];
return fs.readFileSync(NDX,'utf8').split(/\n+/).filter(Boolean).map(l=>{
const [date, slug, type, hash, rel] = l.split('\t');
return {date, slug, type, hash, rel};
});
}
function days(s){ return Math.floor((NOW - new Date(s+'T00:00:00Z'))/86400000); }
function pickTopic(type){
const map = { Pricing:'Pricing', ToS:'Terms of Service', DPA:'DPA', Subprocessors:'Subprocessors', Status:'Status' };
return map[type] || type;
}
function changeImpact(type){
if (type==='Pricing') return 'Budget/renewal risk';
if (type==='ToS') return 'Legal/arbitration/termination';
if (type==='DPA') return 'Privacy/processing terms';
if (type==='Subprocessors') return 'Vendor risk/DP addendum';
if (type==='Status') return 'SLA/incident history';
return 'Contract/Compliance';
}
function ensureDir(p){ fs.mkdirSync(p, { recursive:true }); }


function renderPack(vendor, records){
// What：按类别聚合；So：影响类别；Now：建议动作
const buckets = {};
for (const r of records){ (buckets[r.type]=buckets[r.type]||[]).push(r); }
const what = Object.entries(buckets).map(([k,arr])=>`<li><b>${pickTopic(k)}</b>: ${arr.length} change(s) in last 90 days</li>`).join('');
const so = Object.keys(buckets).map(k=>changeImpact(k)).filter((v,i,a)=>a.indexOf(v)===i).join(' · ');
const now = [
'Lock pricing / request grandfathering when renewing',
'Review arbitration/termination clauses with Legal',
'Update internal register & notify stakeholders if material'
];
const rows = records.slice(0,200).map(r=>{
return `<tr><td>${r.date}</td><td>${pickTopic(r.type)}</td><td><code>${r.hash.slice(0,8)}</code></td><td><a href="/${r.rel.replace(/\\/g,'/')}">evidence</a></td></tr>`;
}).join('');


return `<!doctype html><html><head><meta charset="utf-8"><title>${vendor} Change Pack (${CUR})</title>
<meta name="description" content="Verifiable public changes for ${vendor} in ${CUR}">
<link rel="canonical" href="/reports/${CUR}/${vendor}/">
<script type="application/ld+json">${JSON.stringify({
'@context':'https://schema.org', '@type':'Report',
name:`${vendor} Change Pack ${CUR}`,
datePublished:new Date().toISOString(),
about:vendor
})}</script>
<style>body{font-family:system-ui,Segoe UI,Arial;line-height:1.5;padding:24px;max-width:920px;margin:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}code{background:#f5f5f5;padding:2px 4px;border-radius:4px}</style>
</head><body>
<h1>${vendor} — Change Pack (${CUR})</h1>
<h3>What</h3><ul>${what}</ul>
<h3>So What</h3><p>${so}</p>
<h3>Now What</h3><ul>${now.map(s=>`<li>${s}</li>`).join('')}</ul>
<h3>Verifiable evidence</h3>
<table><thead><tr><th>Date</th><th>Type</th><th>Hash</th><th>Link</th></tr></thead><tbody>${rows}</tbody></table>
})();
