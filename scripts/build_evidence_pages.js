#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const EVIDENCE_DIR = path.join(process.cwd(), 'evidence');

function esc(s){
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function renderCard(vendor, baseName, data){
  const whenUTC = data.detected_at || data.timestamp || '';
  const dateShort = whenUTC ? whenUTC.slice(0,10) : '';
  const shaFull = data.sha256 || data.hash || '';
  const shaShort = shaFull.slice(0,8);

  const HEADER = `
<header class="app-header">
  <div class="nav container">
    <a class="logo" href="/">CG Alert</a>
    <a href="/reports/">Reports</a>
    <a href="/who-uses/">Who Uses</a>
    <a href="/rss.xml" rel="nofollow">RSS</a>
  </div>
</header>`.trim();

  const prettyJson = JSON.stringify(data,null,2);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evidence — ${esc(vendor)} — ${esc(data.type || data.kind || '')} — ${esc(dateShort)} · CG Alert</title>
<meta name="description" content="Timestamped evidence card for ${esc(vendor)} ${esc(data.type || data.kind || '')} change on ${esc(dateShort)} (UTC). Includes source URL and cryptographic hash for audit; public sources only.">
<link rel="canonical" href="/evidence/${esc(vendor)}/${esc(baseName)}.html">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0b0d12">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/assets/cg-theme.css">
<style>
.table-meta{
  width:100%;
  border-collapse:collapse;
  font-size:14px;
  line-height:1.5;
  margin:16px 0;
}
.table-meta th{
  text-align:left;
  padding:6px 8px;
  color:var(--muted);
  border-bottom:1px solid var(--border);
  white-space:nowrap;
  font-weight:500;
  font-size:12px;
  text-transform:uppercase;
  letter-spacing:.03em;
}
.table-meta td{
  padding:6px 8px;
  border-bottom:1px solid var(--border);
  word-break:break-word;
}
pre.evidence-json{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:var(--radius);
  box-shadow:var(--shadow);
  padding:16px;
  font-size:12px;
  line-height:1.4;
  overflow-x:auto;
  white-space:pre;
}
.small{
  color:var(--muted);
  font-size:12px;
  line-height:1.4;
  margin-top:8px;
}
</style>
</head>
<body>
${HEADER}
<main class="main container" id="main">
  <div class="section"><div class="container">
    <h1 class="h1">Evidence Card — ${esc(vendor)}</h1>
    <p class="sub">Captured <strong>${esc(whenUTC)}</strong> (UTC)</p>

    <div class="card">
      <table class="table-meta">
        <tr><th>Vendor</th><td>${esc(vendor)}</td></tr>
        <tr><th>Type</th><td>${esc(data.type || data.kind || '')}</td></tr>
        <tr><th>Source URL</th><td><a class="link" href="${esc(data.url || '')}" rel="nofollow noopener noreferrer" target="_blank">${esc(data.url || '')}</a></td></tr>
        <tr><th>SHA256</th><td><code>#${esc(shaShort)}</code></td></tr>
        <tr><th>Commit</th><td><code>${esc(data.commit || '')}</code></td></tr>
      </table>
      <p class="small">
        Public-source only. We snapshot minimal public text, URL, timestamp, and a cryptographic hash.
        This is for Procurement / Legal Ops / Finance to audit vendor changes and pricing leverage.
        Not legal advice.
      </p>
    </div>

    <div class="card" style="margin-top:24px;">
      <h2 class="h1" style="font-size:16px;margin:0 0 12px 0;">Raw Evidence JSON</h2>
      <pre class="evidence-json">${esc(prettyJson)}</pre>
    </div>

    <div class="card">
      <a class="btn ghost" href="/reports/">All Reports</a>
      <a class="btn ghost" href="/rss.xml" rel="nofollow">RSS</a>
    </div>

  </div></div>
</main>
<footer class="container">© CG Alert — Evidence-backed vendor change alerts.</footer>
</body>
</html>`;
}

function buildAll(){
  if(!fs.existsSync(EVIDENCE_DIR)) return;
  for(const vendor of fs.readdirSync(EVIDENCE_DIR)){
    const vDir = path.join(EVIDENCE_DIR, vendor);
    if(!fs.statSync(vDir).isDirectory()) continue;
    for(const f of fs.readdirSync(vDir)){
      if(!f.endsWith('.json')) continue;
      const base = f.replace(/\.json$/,'');
      let data;
      try{
        data = JSON.parse(fs.readFileSync(path.join(vDir,f),'utf8'));
      }catch{ continue; }
      const html = renderCard(vendor, base, data);
      fs.writeFileSync(path.join(vDir, base+'.html'), html, 'utf8');
      console.log('evidence page built:', vendor, base);
    }
  }
}

buildAll();
