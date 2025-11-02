// scripts/monthly_digest.js (CommonJS)
const fs = require('fs'); const path = require('path');
const month = new Date().toISOString().slice(0,7);
const OUT = path.join('public','digests',`${month}.html`);
fs.mkdirSync(path.dirname(OUT), {recursive:true});
const html = `<!doctype html><meta charset="utf-8"><title>CG Alert — ${month} Digest</title>
<h1>Monthly Digest — ${month}</h1>
<p>Evidence-backed changes summarized for the month.</p>`;
fs.writeFileSync(OUT, html);
console.log('wrote', OUT);
