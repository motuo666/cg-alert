#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(process.cwd(), 'reports');
const EVIDENCE_DIR = path.join(process.cwd(), 'evidence');

function esc(s){
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// Pull narrative blocks (What / So What / Now What) from old vendor HTML so we keep your human analysis.
function extractNarrative(html) {
  function between(a,b){
    const re=new RegExp(a+'([\\s\\S]*?)'+b,'i');
    const m=html.match(re);
    return m?m[1].trim():'';
  }
  return {
    what:   between('<h3>\\s*What\\s*</h3>',        '<h3>\\s*So\\s*What\\s*</h3>'),
    soWhat: between('<h3>\\s*So\\s*What\\s*</h3>',  '<h3>\\s*Now\\s*What\\s*</h3>'),
    nowWhat:between('<h3>\\s*Now\\s*What\\s*</h3>', '<h3>\\s*Verifiable\\s*evidence\\s*</h3>')
  };
}

// Build evidence rows for a specific vendor+month.
function collectEvidence(vendor, month){
  const dir = path.join(EVIDENCE_DIR, vendor);
  const rows=[];
  if(fs.existsSync(dir)){
    for(const f of fs.readdirSync(dir)){
      if(!f.endsWith('.json')) continue;
      if(!f.startsWith(month+'-')) continue; // only that YYYY-MM
      let data;
      try{ data=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); }
      catch{ continue; }

      // filename sample: 2025-10-13-DPA-76e76fef-00000000.json
      const base = f.replace(/\.json$/,'');
      const parts = base.split('-'); // [YYYY,MM,DD,Type,...sig]
      const dateStr = parts.slice(0,3).join('-');
      const typeStr = parts.slice(3).join('-');

      const shaFull = data.sha256 || data.hash || '';
      const hashShort = shaFull.slice(0,8);

      rows.push({
        when: dateStr,
        typ: typeStr,
        hashShort,
        hrefBase: base,
        excerpt: '' // reserved for future diff summary
      });
    }
  }

  rows.sort((a,b)=>{
    if(a.when < b.when) return 1;
    if(a.when > b.when) return -1;
    return a.typ.localeCompare(b.typ);
  });

  const lastChange = rows[0]?.when || '';
  const evidenceCount = rows.length;
  let verifiedHash = '';
  let commitId = '';
  if(rows.length){
    const firstJson = rows[0].hrefBase + '.json';
    const obj = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR,vendor,firstJson),'utf8'));
    const hfull = obj.sha256 || obj.hash || '';
    verifiedHash = hfull.slice(0,8);
    commitId = obj.commit || '';
  }

  return { rows, lastChange, evidenceCount, verifiedHash, commitId };
}

function impactFromCount(n){
  if(n>=20) return 'High';
  if(n>=6)  return 'Medium';
  return 'Low';
}

function renderVendorPage(vendor, month, nar, ev){
  const HEADER = `
<header class="app-header">
  <div class="nav container">
    <a class="logo" href="/">CG Alert</a>
    <a href="/reports/">Reports</a>
    <a href="/who-uses/">Who Uses</a>
    <a href="/rss.xml" rel="nofollow">RSS</a>
  </div>
</header>`.trim();

  const chips = [
    ev.lastChange && `Last change: ${esc(ev.lastChange)}`,
    `Evidence: ${esc(ev.evidenceCount)}`,
    `Impact: ${esc(impactFromCount(ev.evidenceCount))}`,
    ev.verifiedHash && `Verified • #${esc(ev.verifiedHash)}${ev.commitId?` • ${esc(ev.commitId)}`:''}`
  ].filter(Boolean);

  const tableRowsHtml = ev.rows.map(r => {
    // point to .html evidence card (not raw .json)
    const evHref = `/evidence/${encodeURIComponent(vendor)}/${r.hrefBase}.html`;
    return `<tr>
      <td>${esc(r.when)}</td>
      <td>${esc(r.typ)}</td>
      <td><code>#${esc(r.hashShort)}</code></td>
      <td><a class="link" href="${evHref}" rel="nofollow">evidence</a></td>
      <td>${esc(r.excerpt)}</td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(vendor)} — Change Pack (${esc(month)}) · CG Alert</title>
<meta name="description" content="Evidence-backed public changes for ${esc(vendor)} in ${esc(month)}. Timestamped, hashed, commit-referenced. For Procurement / Legal Ops / Finance. Not legal advice.">
<link rel="canonical" href="/reports/${esc(month)}/${esc(vendor)}/">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0b0d12">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/assets/cg-theme.css">
<style>
html,body{
  background:#fff !important;
  color:#0b0d12;
}
.kv{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  margin:.75rem 0 1.25rem;
}
.kv span{
  display:inline-block;
  background:var(--bg);
  border:1px solid var(--border);
  border-radius:999px;
  padding:.3rem .6rem;
  font-size:12px;
  color:var(--muted);
  line-height:1.4;
}
.card + .card{margin-top:16px;}
.card h2.h1{
  font-size:16px;
  margin:0 0 8px 0;
  font-weight:600;
  color:var(--ink);
}
.table-changes{
  width:100%;
  border-collapse:collapse;
  font-size:14px;
  line-height:1.5;
}
.table-changes thead th{
  background:var(--card);
  text-align:left;
  padding:8px;
  border-bottom:1px solid var(--border);
  font-weight:500;
  font-size:12px;
  text-transform:uppercase;
  letter-spacing:.03em;
  color:var(--muted);
}
.table-changes td{
  padding:8px;
  border-bottom:1px solid var(--border);
  vertical-align:top;
}
code{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:4px;
  padding:2px 4px;
  font-size:12px;
}
.small{
  color:var(--muted);
  font-size:12px;
  line-height:1.4;
  margin-top:8px;
}
.btn-row{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
}
</style>
</head>
<body>
${HEADER}
<main class="main container" id="main">
  <div class="section"><div class="container">

    <h1 class="h1">${esc(vendor)} — Change Pack (${esc(month)})</h1>

    <div class="kv">
      ${chips.map(t=>`<span>${t}</span>`).join('')}
    </div>

    <div class="card">
      <h2 class="h1">What</h2>
      ${nar.what || '<p class="sub">No summary.</p>'}
    </div>

    <div class="card">
      <h2 class="h1">So What</h2>
      ${nar.soWhat || '<p class="sub">No summary.</p>'}
    </div>

    <div class="card">
      <h2 class="h1">Now What</h2>
      ${nar.nowWhat || '<p class="sub">No summary.</p>'}
    </div>

    <div class="card">
      <h2 class="h1" style="margin-bottom:12px;">Verifiable Evidence</h2>
      <table class="table-changes">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Hash</th>
            <th>Link</th>
            <th>Excerpt</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
      <p class="small">
        Public-source only (Pricing, ToS/MSA, DPA, Subprocessors, Status, etc.).
        We store the timestamp, URL, and a cryptographic hash so Procurement / Legal Ops / Finance can audit.
        Not legal advice.
      </p>
    </div>

    <div class="card">
      <div class="btn-row">
        <a class="btn" href="/">Home</a>
        <a class="btn ghost" href="/reports/">All Reports</a>
        <a class="btn ghost" href="/rss.xml" rel="nofollow">RSS</a>
      </div>
    </div>

  </div></div>
</main>

<footer class="container">© CG Alert — Evidence-backed vendor change alerts.</footer>
</body>
</html>`;
}

function rebuild() {
  if(!fs.existsSync(REPORTS_DIR)) return;
  for(const month of fs.readdirSync(REPORTS_DIR)){
    if(!/^\d{4}-\d{2}$/.test(month)) continue;
    const monthDir = path.join(REPORTS_DIR, month);
    if(!fs.statSync(monthDir).isDirectory()) continue;

    for(const vendor of fs.readdirSync(monthDir)){
      const vendorDir = path.join(monthDir, vendor);
      if(!fs.statSync(vendorDir).isDirectory()) continue;

      const idxPath = path.join(vendorDir,'index.html');
      const oldHtml = fs.existsSync(idxPath)
        ? fs.readFileSync(idxPath,'utf8')
        : '';

      const nar = extractNarrative(oldHtml);
      const ev  = collectEvidence(vendor, month);

      const html = renderVendorPage(vendor, month, nar, ev);
      fs.writeFileSync(idxPath, html, 'utf8');
      console.log('rebuilt vendor page:', idxPath);
    }
  }
}

rebuild();
