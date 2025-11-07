#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(process.cwd(), 'reports');

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function listMonths() {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  return fs.readdirSync(REPORTS_DIR)
    .filter(ym => /^\d{4}-\d{2}$/.test(ym) && fs.statSync(path.join(REPORTS_DIR, ym)).isDirectory())
    .sort()        // oldest→newest
    .reverse()     // newest first
    .map(ym => {
      const monthDir = path.join(REPORTS_DIR, ym);
      const vendors = fs.readdirSync(monthDir)
        .filter(v => fs.statSync(path.join(monthDir, v)).isDirectory())
        .sort((a,b)=>a.localeCompare(b));
      return { ym, vendors };
    });
}

function render() {
  const months = listMonths();
  const updatedUTC = new Date()
    .toISOString()
    .replace('T',' ')
    .replace(/\..+/, ' UTC');

  // 统一顶栏导航：CG Alert / Reports / Who Uses / RSS
  // 线上 /reports/ 也是这个导航结构。
  const HEADER_BLOCK = `
<header class="app-header">
  <div class="nav container">
    <a class="logo" href="/">CG Alert</a>
    <a href="/reports/">Reports</a>
    <a href="/who-uses/">Who Uses</a>
    <a href="/rss/index.xml" rel="nofollow">RSS</a>
  </div>
</header>`.trim();

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CG Alert — Reports</title>
<meta name="description" content="Vendor Change Packs. Verified change packs by month and vendor. All times in UTC.">
<link rel="canonical" href="https://www.cg-alert.com/reports/">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0b0d12">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/assets/cg-theme.css">
<style>
.table-month{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:var(--radius);
  box-shadow:var(--shadow);
  padding:18px;
  margin:16px 0 32px 0;
}
.table-month h2{
  font-size:16px;
  margin:0 0 12px 0;
  font-weight:600;
  color:var(--ink);
}
.table-month ul{
  margin:0;
  padding-left:20px;
  line-height:1.7;
  font-size:14px;
}
.meta{
  color:var(--muted);
  font-size:12px;
  margin-top:4px
}
</style>
</head>
<body>
${HEADER_BLOCK}
<main class="main container" id="main">
  <div class="section"><div class="container">
    <h1 class="h1">Vendor Change Packs</h1>
    <p class="sub">Verified change packs by month and vendor. All times in UTC.</p>
    <div class="meta">Last updated ${esc(updatedUTC)}</div>
    ${months.map(m => `
      <div class="table-month">
        <h2>${esc(m.ym)}</h2>
        <ul>
        ${m.vendors.map(v => `
          <li><a class="link" href="/reports/${esc(m.ym)}/${esc(v)}/">${esc(v)}</a></li>
        `).join('')}
        </ul>
      </div>
    `).join('')}
  </div></div>
</main>
<footer class="container">© CG Alert — Evidence-backed vendor change alerts.</footer>
</body>
</html>`;

  fs.writeFileSync(path.join(REPORTS_DIR, 'index.html'), html, 'utf8');
  console.log('reports/index.html rebuilt');
}

render();
