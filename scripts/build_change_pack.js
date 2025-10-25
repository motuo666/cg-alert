#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(process.cwd(), 'reports');
const EVIDENCE_DIR = path.join(process.cwd(), 'evidence');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// 把旧 vendor index.html 里的摘要段落抠出来，避免丢掉人工信号
// <h3>What</h3> ... <h3>So What</h3>
// <h3>So What</h3> ... <h3>Now What</h3>
// <h3>Now What</h3> ... <h3>Verifiable evidence</h3>
function extractSummaryBlocks(oldHtml) {
  function grab(a, b) {
    const re = new RegExp(a + '([\\s\\S]*?)' + b, 'i');
    const m = oldHtml.match(re);
    return m ? m[1].trim() : '';
  }
  const whatHtml   = grab('<h3>\\s*What\\s*</h3>',        '<h3>\\s*So\\s*What\\s*</h3>');
  const soWhatHtml = grab('<h3>\\s*So\\s*What\\s*</h3>',  '<h3>\\s*Now\\s*What\\s*</h3>');
  const nowWhatHtml= grab('<h3>\\s*Now\\s*What\\s*</h3>', '<h3>\\s*Verifiable\\s*evidence\\s*</h3>');
  return { whatHtml, soWhatHtml, nowWhatHtml };
}

// 读取 evidence/<vendor>/YYYY-MM-*.json -> 构造表格行
function collectEvidenceFor(vendor, month) {
  const dir = path.join(EVIDENCE_DIR, vendor);
  const rows = [];
  if (fs.existsSync(dir)) {
    for (const fname of fs.readdirSync(dir)) {
      if (!fname.endsWith('.json')) continue;
      if (!fname.startsWith(month + '-')) continue;
      const fpath = path.join(dir, fname);
      let data;
      try {
        data = JSON.parse(fs.readFileSync(fpath,'utf8'));
      } catch {
        continue;
      }
      // filename like 2025-10-17-DPA-37cd4f93-00000000.json
      const parts = fname.replace(/\.json$/,'').split('-');
      // parts[0]=YYYY parts[1]=MM parts[2]=DD parts[3]=Type parts[4]=sig
      const dateStr = parts.slice(0,3).join('-');
      const kind = parts[3] + (parts[4] ? '-' + parts[4] : '');
      const hashFull = data.hash || data.sha256 || '';
      const hashShort = hashFull.slice(0,8);

      rows.push({
        when: dateStr,
        kind,
        hashShort,
        file: fname,
        note: '' // placeholder; can be filled later if you add excerpts
      });
    }
  }

  // 最新的排在上面
  rows.sort((a,b)=>{
    if (a.when < b.when) return 1;
    if (a.when > b.when) return -1;
    return a.kind.localeCompare(b.kind);
  });

  const lastChange      = rows.length ? rows[0].when : '';
  const evidenceCount   = rows.length;
  let verifiedHash = '';
  let commitId = '';
  if (rows.length) {
    const firstData = JSON.parse(
      fs.readFileSync(path.join(dir, rows[0].file),'utf8')
    );
    const hfull = firstData.hash || firstData.sha256 || '';
    verifiedHash = hfull.slice(0,8);
    commitId = firstData.commit || '';
  }

  return {
    rows,
    lastChange,
    evidenceCount,
    verifiedHash,
    commitId
  };
}

function labelImpact(evidenceCount) {
  if (evidenceCount >= 20) return 'High';
  if (evidenceCount >= 6)  return 'Medium';
  return 'Low';
}

// 生成最终 HTML（统一导航 + 白底 + 卡片）
// 和线上 cg-alert.com 风格保持一致：顶部横向导航 + 合规/审计语气，企业风。
function renderVendorPage(vendor, month, blocks, ev) {
  const HEADER_BLOCK = `
<header class="app-header">
  <div class="nav container">
    <a class="logo" href="/">CG Alert</a>
    <a href="/reports/">Reports</a>
    <a href="/who-uses/">Who Uses</a>
    <a href="/rss.xml" rel="nofollow">RSS</a>
  </div>
</header>`.trim();

  const impact = labelImpact(ev.evidenceCount);
  const verifiedChip = ev.verifiedHash
    ? `Verified • #${esc(ev.verifiedHash)}${ev.commitId ? ' • ' + esc(ev.commitId) : ''}`
    : '';

  const tableRowsHtml = ev.rows.map(r => {
    // Evidence 链接改成 .html（我们会用 build_evidence_pages.js 生成）
    const evHref = `/evidence/${encodeURIComponent(vendor)}/${r.file.replace(/\.json$/,'')}.html`;
    return `
      <tr>
        <td>${esc(r.when)}</td>
        <td>${esc(r.kind)}</td>
        <td><code>#${esc(r.hashShort)}</code></td>
        <td><a class="link" href="${evHref}" rel="nofollow">evidence</a></td>
        <td>${esc(r.note || '')}</td>
      </tr>`;
  }).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(vendor)} — Change Pack (${esc(month)}) · CG Alert</title>
<meta name="description" content="Evidence-backed public changes for ${esc(vendor)} in ${esc(month)}. Includes timestamp, hash, commit for audit.">
<link rel="canonical" href="/reports/${esc(month)}/${esc(vendor)}/">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0b0d12">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/assets/cg-theme.css">
<style>
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
.section-block{margin:24px 0;}
.section-block .card{margin-bottom:16px;}
.kv{display:flex;flex-wrap:wrap;gap:10px;margin:.5rem 0 1rem;}
.kv span{
  display:inline-block;
  background:var(--bg);
  border:1px solid var(--border);
  border-radius:999px;
  padding:.2rem .55rem;
  font-size:12px;
  color:var(--muted);
}
</style>
</head>
<body>
${HEADER_BLOCK}
<main class="main container" id="main">
  <div class="section"><div class="container">

    <h1 class="h1">${esc(vendor)} — Change Pack (${esc(month)})</h1>
    <div class="kv">
      ${ev.lastChange ? `<span>Last change: ${esc(ev.lastChange)}</span>` : ''}
      <span>Evidence: ${esc(ev.evidenceCount)}</span>
      <span>Impact: ${esc(impact)}</span>
      ${verifiedChip ? `<span>${verifiedChip}</span>` : ''}
    </div>

    <div class="section-block">
      <div class="card">
        <h2 class="h1" style="font-size:16px;margin:0 0 8px 0;">What</h2>
        ${blocks.whatHtml || '<p class="sub">No summary.</p>'}
      </div>
      <div class="card">
        <h2 class="h1" style="font-size:16px;margin:0 0 8px 0;">So What</h2>
        ${blocks.soWhatHtml || '<p class="sub">No summary.</p>'}
      </div>
      <div class="card">
        <h2 class="h1" style="font-size:16px;margin:0 0 8px 0;">Now What</h2>
        ${blocks.nowWhatHtml || '<p class="sub">No summary.</p>'}
      </div>
    </div>

    <div class="card">
      <h2 class="h1" style="font-size:16px;margin:0 0 12px 0;">Verifiable Evidence</h2>
      <table class="table-changes">
        <thead>
          <tr><th>Date</th><th>Type</th><th>Hash</th><th>Link</th><th>Excerpt</th></tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
      <p class="small">
        Evidence cards are generated from public pages only. We store timestamp, URL,
        and a cryptographic hash for audit. Not legal advice.
      </p>
    </div>

    <div class="section-block">
      <a class="btn" href="/">Back to Home</a>
      <a class="btn ghost" href="/reports/">All Reports</a>
      <a class="btn ghost" href="/rss.xml" rel="nofollow">RSS</a>
    </div>

  </div></div>
</main>
<footer class="container">© CG Alert — Evidence-backed vendor change alerts.</footer>
</body>
</html>`;

  return html;
}

function rebuildAllVendors() {
  if (!fs.existsSync(REPORTS_DIR)) return;
  for (const ym of fs.readdirSync(REPORTS_DIR)) {
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const ymDir = path.join(REPORTS_DIR, ym);
    if (!fs.statSync(ymDir).isDirectory()) continue;

    for (const vendor of fs.readdirSync(ymDir)) {
      const vendorDir = path.join(ymDir, vendor);
      if (!fs.statSync(vendorDir).isDirectory()) continue;

      const idxPath = path.join(vendorDir, 'index.html');
      let oldHtml = '';
      if (fs.existsSync(idxPath)) {
        oldHtml = fs.readFileSync(idxPath,'utf8');
      }

      const blocks = extractSummaryBlocks(oldHtml);
      const ev = collectEvidenceFor(vendor, ym);

      const html = renderVendorPage(vendor, ym, blocks, ev);
      fs.writeFileSync(idxPath, html, 'utf8');
      console.log('rebuilt vendor page:', idxPath);
    }
  }
}

rebuildAllVendors();
