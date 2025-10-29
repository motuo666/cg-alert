// Update CTA blocks across pages to align with 3-SKU pricing.
// Usage: node scripts/pricing_sync.js
// Looks for old "Buy Portfolio · $2,988/yr" style blocks and replaces with new 3-card CTA.
// Requires env vars: STRIPE_LINK_RENEWAL_DESK, STRIPE_LINK_PORTFOLIO, STRIPE_LINK_COMPLIANCE.

const fs = require('fs');
const path = require('path');

const ROOTS = [
  '.', 'seo', 'who-uses', 'enterprise', 'dashboard'
];

const REN = process.env.STRIPE_LINK_RENEWAL_DESK || '';
const POR = process.env.STRIPE_LINK_PORTFOLIO || '';
const COM = process.env.STRIPE_LINK_COMPLIANCE || '';
const INTAKE = process.env.INTAKE_FORM_URL || '#';

if (!REN || !POR || !COM) {
  console.error('Missing STRIPE_LINK_* vars. Aborting.');
  process.exit(1);
}

const NEW_BLOCK = `
<section id="cta" class="cta three-sku">
  <div class="cta-grid">
    <div class="card">
      <h3>Renewal Desk</h3>
      <p>Prebuilt evidence & escalation language. Timestamped changes across pricing / SLA / liability / DPA / subprocessors.</p>
      <a class="btn" href="${REN}" rel="noopener">Buy Renewal Desk</a>
    </div>
    <div class="card">
      <h3>Portfolio</h3>
      <p>We continuously monitor up to 3 named vendors you specify and give you copy-pastable leverage language.</p>
      <a class="btn" href="${POR}" rel="noopener">Buy Portfolio</a>
    </div>
    <div class="card">
      <h3>Compliance & Vendor Risk</h3>
      <p>Track DPA / subprocessors / liability changes and surface exposures for risk & compliance teams.</p>
      <a class="btn" href="${COM}" rel="noopener">Buy Compliance & Vendor Risk</a>
    </div>
  </div>
  <p class="cta-note">Fully async. No calls. Evidence-backed alerts.</p>
</section>
`;

function replaceInFile(file) {
  const html = fs.readFileSync(file, 'utf8');

  // Replace old single-CTA block heuristically
  const patterns = [
    /<section[^>]*id=["']?cta["']?[^>]*>[\s\S]*?<\/section>/i,
    /<div class=["']?cta["']?[^>]*>[\s\S]*?<\/div>/i,
    /Buy\s+Portfolio[^<]{0,200}<\/a>/i
  ];

  let out = html;
  let replaced = false;
  for (const pat of patterns) {
    if (pat.test(out)) {
      out = out.replace(pat, NEW_BLOCK);
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    // Try injecting after the first <main> or <header>
    out = out.replace(/<main[^>]*>/i, m => m + "\n" + NEW_BLOCK + "\n");
  }

  // Ensure canonical on homepage-level pages
  if (!/rel=["']canonical["']/.test(out)) {
    out = out.replace(/<head>/i, '<head>\n<link rel="canonical" href="https://www.cg-alert.com/">');
  }

  fs.writeFileSync(file, out, 'utf8');
  console.log('Patched CTA:', file);
}

function walkAndPatch(rel) {
  const dir = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir);
  for (const e of entries) {
    const p = path.join(dir, e);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      // Only patch root pages, not reports/evidence massive trees
      continue;
    }
    if (e.endsWith('.html')) {
      replaceInFile(p);
    }
  }
}

for (const r of ROOTS) {
  walkAndPatch(r);
}
console.log('3-SKU CTA sync complete.');
