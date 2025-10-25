const fs = require('fs');
const path = require('path');

const reportsDir = 'reports';
fs.mkdirSync(reportsDir, { recursive: true });

function listMonths() {
  if (!fs.existsSync(reportsDir)) return [];
  return fs.readdirSync(reportsDir)
    .filter(ym => /^\d{4}-\d{2}$/.test(ym) && fs.statSync(path.join(reportsDir, ym)).isDirectory())
    .sort()
    .reverse()
    .map(ym => {
      const vendors = fs.readdirSync(path.join(reportsDir, ym))
        .filter(v => fs.existsSync(path.join(reportsDir, ym, v, 'index.html')))
        .sort();
      return { ym, vendors };
    });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

const HEADER_BLOCK = `
<header class="app-header">
  <div class="nav container">
    <a class="logo" href="/"><img src="/icon.svg" alt="CG Alert">CG Alert</a>
    <a href="/reports/">Reports</a>
    <a href="/who-uses/">Who Uses</a>
    <a href="/rss.xml" rel="nofollow">RSS</a>
  </div>
</header>
`.trim();

const months = listMonths();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CG Alert — Reports</title>
<link rel="canonical" href="https://www.cg-alert.com/reports/">

<!-- 全站样式，保持和0009.zip一致 -->
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/assets/cg-theme.css">

<!-- 强制浅色+白底，干掉“右侧整块黑边” -->
<style>
  body {
    background: #fff !important;
    color: #000 !important;
    margin: 0;
    line-height: 1.55;
    font-family: system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  }
  main.page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
  }
  main.page section { margin: 24px 0; }
  main.page ul { line-height: 1.8; }
  h1 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 16px 0 8px;
  }
  h2 {
    font-size: 1rem;
    font-weight: 600;
    margin: 24px 0 8px;
  }
  a { color: #000; text-decoration: underline; }
</style>

<meta name="color-scheme" content="light">
<meta name="theme-color" content="#0b0">
</head>
<body>
${HEADER_BLOCK}
<main class="page container">
  <h1>Vendor Change Packs</h1>
  <p class="sub">Verified change packs by month and vendor. All times in UTC.</p>

  ${months.map(m => `
    <section>
      <h2>${escapeHtml(m.ym)}</h2>
      <ul>
        ${m.vendors.map(v => `
          <li>
            <a href="/reports/${escapeHtml(m.ym)}/${escapeHtml(v)}/">${escapeHtml(v)}</a>
          </li>
        `).join('')}
      </ul>
    </section>
  `).join('')}
</main>
</body>
</html>`;

fs.writeFileSync(path.join(reportsDir, 'index.html'), html);
console.log('reports/index.html rebuilt with nav, white background, absolute links');
