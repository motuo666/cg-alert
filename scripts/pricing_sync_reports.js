// scripts/pricing_sync_reports.js
// Remove stale "$2,988/yr" CTA labels inside /reports/**/index.html
// and ensure href points to STRIPE_LINK_PORTFOLIO (no price text).

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PORTFOLIO = process.env.STRIPE_LINK_PORTFOLIO || '';
if (!PORTFOLIO) {
  console.error('Missing STRIPE_LINK_PORTFOLIO'); process.exit(1);
}

function* walk(dir) {
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name === 'index.html' && /\/reports\//.test(p.replace(/\\/g,'/'))) yield p;
  }
}

function patch(html) {
  let changed = false;
  // strip old price from Portfolio anchor text
  html = html.replace(/>Buy Portfolio[^<]*<\/a>/gi, s => {
    changed = true;
    return s.replace(/>Buy Portfolio[^<]*</i, '>Buy Portfolio<');
  });
  // fix hrefs that may point to old stripe or netlify functions
  html = html.replace(/href=["'][^"']*stripe[^"']*["']/gi, `href="${PORTFOLIO}"`);
  return { html, changed };
}

let filesPatched = 0;
for (const file of walk(path.join(ROOT, 'reports'))) {
  const html = fs.readFileSync(file, 'utf8');
  const { html: out, changed } = patch(html);
  if (changed) {
    fs.writeFileSync(file, out, 'utf8');
    filesPatched++;
  }
}

console.log(`pricing_sync_reports: patched files ${filesPatched}`);
