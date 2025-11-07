// Normalize CTA blocks across pages to align with 3-tier pricing (Portfolio, Business, Enterprise).
// Usage: node scripts/pricing_sync.js
// Requires env: STRIPE_LINK_PORTFOLIO, STRIPE_LINK_BUSINESS, INTAKE_FORM_URL
// Enterprise always routes to intake form (no Stripe link).

const fs = require('fs');
const path = require('path');

function env(k, d=''){ const v=process.env[k]; return (v===undefined||v===null||v==='')?d:String(v); }

const ROOTS = ['.', 'seo', 'who-uses', 'enterprise', 'dashboard', 'pricing'];
const STRIPE_PORT = env('STRIPE_LINK_PORTFOLIO', '');
const STRIPE_BUSI = env('STRIPE_LINK_BUSINESS', '');
const INTAKE = env('INTAKE_FORM_URL', '/intake/');

if (!STRIPE_PORT || !STRIPE_BUSI) {
  console.log('pricing_sync: STRIPE_LINK_PORTFOLIO/STRIPE_LINK_BUSINESS should be set; proceeding without hard fail.');
}

const CTA = (href, label) => `<a class="btn" href="${href}" rel="noopener">${label}</a>`;

const snippet = `
<section id="pricing" class="pricing three">
  <div class="cards">
    <div class="card">
      <h3>Portfolio</h3>
      <p class="price">$2,988/yr</p>
      <ul>
        <li>Up to 25 vendors monitored</li>
        <li>Evidence cards (snippet + URL + timestamp + hash)</li>
        <li>Weekly cadence</li>
        <li>Email delivery · Fully async · No calls</li>
        <li>30‑day money‑back if no material alert</li>
      </ul>
      ${CTA(STRIPE_PORT || '#', 'Buy $ 2,988')}
    </div>
    <div class="card">
      <h3>Business</h3>
      <p class="price">$6,000/yr</p>
      <ul>
        <li>Up to 50 vendors monitored</li>
        <li>Upgraded evidence (before/after + negotiation language)</li>
        <li>Daily/Weekly cadence</li>
        <li>Email delivery · Fully async · No calls</li>
        <li>Quarterly 1‑pager executive summary</li>
      </ul>
      ${CTA(STRIPE_BUSI || '#', 'Buy $ 6,000')}
    </div>
    <div class="card">
      <h3>Enterprise</h3>
      <p class="price">Starts $18,000+/yr</p>
      <ul>
        <li>Up to 200 vendors monitored</li>
        <li>Custom cadence · Email delivery</li>
        <li>Downloadable packs (ZIP/CSV/JSON)</li>
        <li>Renewal Pack (evidence + escalation language)</li>
      </ul>
      ${CTA(INTAKE, 'Request Enterprise →')}
    </div>
  </div>
</section>
`.trim();

function replacePricing(html){
  // If a #pricing section exists, replace the entire section; else append to end.
  const has = /<section[^>]*id=["']pricing["'][\s\S]*?<\/section>/i.test(html);
  if(has){
    return html.replace(/<section[^>]*id=["']pricing["'][\s\S]*?<\/section>/i, snippet);
  }
  return html.replace(/<\/body>\s*<\/html>/i, snippet + '\n</body></html>');
}

function walk(d){
  return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{
    const p = path.join(d, e.name);
    if(e.isDirectory()) return walk(p);
    if(/\.(html?)$/i.test(e.name)) return [p];
    return [];
  });
}

let touched = 0;
for(const base of ROOTS){
  if(!fs.existsSync(base)) continue;
  for(const f of walk(base)){
    const s = fs.readFileSync(f, 'utf8');
    const n = replacePricing(s);
    if(n !== s){
      fs.writeFileSync(f, n);
      touched++;
    }
  }
}

if (fs.existsSync('dashboard/index.html')) {
  // Also normalize dashboard CTAs (buy buttons -> correct links)
  let s = fs.readFileSync('dashboard/index.html','utf8');
  s = s.replace(/href="https?:\/\/buy\.stripe\.com\/[^"]+"/g, `href="${STRIPE_PORT || '#'}"`);
  fs.writeFileSync('dashboard/index.html', s);
}

fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/pricing_sync.txt', `touched=${touched}\n`);
console.log(`pricing_sync: touched=${touched}`);
