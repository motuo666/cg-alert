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
const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CG Alert — Reports</title>
<link rel="canonical" href="https://www.cg-alert.com/reports/">
<style>body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px}h1{margin:0 0 16px}section{margin:24px 0}ul{line-height:1.8}</style>
</head><body>
<h1>Vendor Change Packs</h1>
<p>Verified change packs by month and vendor. All times in UTC.</p>
${months.map(m => `<section><h2>${m.ym}</h2><ul>${m.vendors.map(v => `<li><a href="./${m.ym}/${encodeURIComponent(v)}/">${v}</a></li>`).join('')}</ul></section>`).join('')}
</body></html>`;
fs.writeFileSync(path.join(reportsDir, 'index.html'), html);
console.log(`reports index generated: months=${months.length}`);
