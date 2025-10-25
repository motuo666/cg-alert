const fs = require('fs');
const path = require('path');

const reportsDir = 'reports';
fs.mkdirSync(reportsDir, { recursive: true });

function listMonths() {
  if (!fs.existsSync(reportsDir)) return [];
  return fs.readdirSync(reportsDir)
    .filter(ym => /^\d{4}-\d{2}$/.test(ym) && fs.statSync(path.join(reportsDir, ym)).isDirectory())
    .sort().reverse()
    .map(ym => {
      const vendors = fs.readdirSync(path.join(reportsDir, ym))
        .filter(v => fs.existsSync(path.join(reportsDir, ym, v, 'index.html')))
        .sort();
      return { ym, vendors };
    });
}

const months = listMonths();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CG Alert — Reports</title>
<link rel="canonical" href="https://www.cg-alert.com/reports/">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/assets/cg-theme.css">
<meta name="color-scheme" content="light">
</head>
<body>
<main class="container">
  <h1>Vendor Change Packs</h1>
  <p class="sub">Verified change packs by month and vendor. All times in UTC.</p>

  ${months.map(m => `
    <section>
      <h2>${m.ym}</h2>
      <ul>
        ${m.vendors.map(vendor => `
          <li><a href="/reports/${m.ym}/${vendor}/">${vendor}</a></li>
        `).join('')}
      </ul>
    </section>
  `).join('')}
</main>
</body>
</html>`;

fs.writeFileSync(path.join(reportsDir, 'index.html'), html);
console.log('reports/index.html rebuilt (styled, containerized, light mode), months=', months.length);
