// scripts/pricing_sync.js
// Node 20+ 运行。Only require Portfolio/Business Stripe links; Enterprise uses form.
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const env = process.env;

// --- Required & Optional ---
const required = {
  STRIPE_LINK_PORTFOLIO: env.STRIPE_LINK_PORTFOLIO || '',
  STRIPE_LINK_BUSINESS: env.STRIPE_LINK_BUSINESS || ''
};
const optional = {
  // Enterprise 不走 Stripe；为空是合理的
  STRIPE_LINK_RENEWAL_DESK: env.STRIPE_LINK_RENEWAL_DESK || '',
  STRIPE_LINK_COMPLIANCE: env.STRIPE_LINK_COMPLIANCE || ''
};

const intake = env.INTAKE_FORM_URL || '';
if (!required.STRIPE_LINK_PORTFOLIO || !required.STRIPE_LINK_BUSINESS) {
  console.error(`::error::Missing required Stripe links. Need STRIPE_LINK_PORTFOLIO & STRIPE_LINK_BUSINESS.`);
  process.exit(1);
}
if (!intake) {
  console.error(`::error::Missing INTAKE_FORM_URL for Enterprise form.`);
  process.exit(1);
}

// --- Synthesize current pricing link model ---
const model = {
  updated_at: new Date().toISOString(),
  plans: {
    portfolio: {
      price: 2988,
      billing: "year",
      link: required.STRIPE_LINK_PORTFOLIO,
      type: "stripe"
    },
    business: {
      price: 6000,
      billing: "year",
      link: required.STRIPE_LINK_BUSINESS,
      type: "stripe"
    },
    enterprise: {
      price: 18000,
      billing: "year+",
      link: intake,               // 企业走表单
      type: "form"
    }
  },
  optional: {
    renewal_desk: optional.STRIPE_LINK_RENEWAL_DESK || null,
    compliance: optional.STRIPE_LINK_COMPLIANCE || null
  }
};

// --- Write data/pricing-links.json (for site or other scripts) ---
const outDir = path.join(process.cwd(), 'data');
const outFile = path.join(outDir, 'pricing-links.json');
fs.mkdirSync(outDir, { recursive: true });
const prev = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
const next = JSON.stringify(model, null, 2);
if (prev !== next) {
  fs.writeFileSync(outFile, next);
  console.log('::notice::pricing-links.json updated');
  // commit (best-effort)
  try {
    execSync('git config user.email "bot@cg-alert.com"');
    execSync('git config user.name "cg-alert-bot"');
    execSync(`git add ${JSON.stringify(path.relative(process.cwd(), outFile))}`);
    execSync('git diff --cached --quiet || git commit -m "chore: Pricing Sync (links regenerated)"');
    // 允许在只读 token 时静默跳过 push
    try { execSync('git pull --rebase --autostash || true'); } catch {}
    try { execSync('git push || true'); } catch {}
  } catch (e) {
    console.log('::warning::Git commit/push skipped:', String(e.message || e));
  }
} else {
  console.log('::notice::pricing-links.json up-to-date (no changes)');
}

if (!optional.STRIPE_LINK_RENEWAL_DESK) {
  console.log('::notice::STRIPE_LINK_RENEWAL_DESK empty (ok, optional)');
}
if (!optional.STRIPE_LINK_COMPLIANCE) {
  console.log('::notice::STRIPE_LINK_COMPLIANCE empty (ok, optional)');
}

console.log('::notice::Pricing Sync completed (Enterprise via form).');
