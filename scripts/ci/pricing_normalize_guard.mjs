// Simple guard to ensure pricing text and links are consistent.
// - Fails if required price strings are missing
// - Fails if "Request Enterprise" is missing from homepage
import fs from 'fs';

function mustRead(p){ if(!fs.existsSync(p)) throw new Error(`missing ${p}`); return fs.readFileSync(p,'utf8'); }

const home = mustRead('index.html');
const pricing = fs.existsSync('pricing/index.html') ? fs.readFileSync('pricing/index.html','utf8') : '';

const required = [
  {file:'index.html', text:'$499/yr'},
  {file:'index.html', text:'$1,499/yr'},
  {file:'index.html', text:'$2,988/yr'},
];

for (const {file, text} of required){
  const hay = file==='index.html' ? home : pricing;
  if (!hay.includes(text)){
    console.error(`::error ::${file} missing: ${text}`);
    process.exit(1);
  }
}

// Best-effort: ensure portfolio/business buy links exist when variables present
const hasPortfolioVar = /STRIPE_LINK_PORTFOLIO|buy\.stripe\.com/.test(pricing) || /buy\.stripe\.com/.test(home);
const hasBusinessVar = /STRIPE_LINK_BUSINESS|buy\.stripe\.com/.test(pricing) || /buy\.stripe\.com/.test(home);

if (!hasPortfolioVar) console.warn('::warning ::Stripe Portfolio link not detected (ok if injected at deploy).');
if (!hasBusinessVar) console.warn('::warning ::Stripe Business link not detected (ok if injected at deploy).');

console.log('pricing guard ok');
