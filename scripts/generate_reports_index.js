// scripts/generate_reports_index.js  (CommonJS)
const fs = require('fs');
const path = require('path');

const reportsDir = 'reports';
fs.mkdirSync(reportsDir, { recursive: true });

function listVendorsByMonth() {
  const months = [];
  if (!fs.existsSync(reportsDir)) return months;
  for (const ym of fs.readdirSync(reportsDir)) {
    const p = path.join(reportsDir, ym);
    if (!/^\d{4}-\d{2}$/.test(ym) || !fs.statSync(p).isDirectory()) continue;
    const vendors = fs.readdirSync(p).filter(v => fs.existsSync(path.join(p, v, 'index.html')));
    months.push({ ym, vendors: vendors.sort() });
  }
  return months.sort((a,b)=>a.ym < b.ym ? 1 : -1);
}

const months = listVendorsByMonth();
const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CG Alert — Reports</title>
<link rel="canonical" href="https://www.cg-alert.com/reports/">
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px}h1{margin:0 0 16px}section{margin:24px 0}ul{line-height:1.8}</style>
</head><body>
<h1>Vendor Change Packs</h1>
<p>Verified change packs by month and vendor. All times in UTC.</p>
${months.map(m => `<section><h2>${m.ym}</h2><ul>` + m.vendors.map(v => `<li><a href="./${m.ym}/${encodeURIComponent(v)}/">${v}</a></li>`).join('') + `</ul></section>`).join('')}
</body></html>`;
fs.writeFileSync(path.join(reportsDir, 'index.html'), html);
console.log(`reports index generated: months=${months.length}`);
