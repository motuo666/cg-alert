// ESM script: scripts/pricing_sync.mjs
// Purpose: keep pricing source of truth in data/pricing.json,
// requiring ONLY Portfolio ($2,988) and Business ($6,000) Stripe links.
// Enterprise ($18,000+) routes to intake form (no Stripe link).
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = process.env;

const SITE_ORIGIN = env.SITE_ORIGIN || 'https://www.cg-alert.com';
const INTAKE_FORM_URL = env.INTAKE_FORM_URL || (SITE_ORIGIN.replace(/\/$/, '') + '/intake/');
const STRIPE_LINK_PORTFOLIO = env.STRIPE_LINK_PORTFOLIO || '';
const STRIPE_LINK_BUSINESS  = env.STRIPE_LINK_BUSINESS  || '';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!STRIPE_LINK_PORTFOLIO) fail('Missing STRIPE_LINK_PORTFOLIO');
if (!STRIPE_LINK_BUSINESS)  fail('Missing STRIPE_LINK_BUSINESS');

const pricing = {
  currency: 'USD',
  tiers: [
    {
      id: 'portfolio',
      title: 'Portfolio',
      price_year: 2988,
      vendors_max: 25,
      buy_link: STRIPE_LINK_PORTFOLIO,
      purchase: 'stripe',
      includes: ['Email alerts','Slack alerts','Evidence cards'],
      refund: '30-day money-back if no material alert'
    },
    {
      id: 'business',
      title: 'Business',
      price_year: 6000,
      vendors_max: 50,
      buy_link: STRIPE_LINK_BUSINESS,
      purchase: 'stripe',
      includes: ['Email alerts','Slack alerts','Evidence cards']
    },
    {
      id: 'enterprise',
      title: 'Enterprise',
      price_year: 18000,
      vendors_max: 200,
      buy_link: null,
      purchase: 'form',
      contact_url: INTAKE_FORM_URL
    }
  ],
  updated_at: new Date().toISOString()
};

const repoRoot = path.resolve(__dirname, '..');
const dataDir = path.join(repoRoot, 'data');
const outFile = path.join(dataDir, 'pricing.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const newJson = JSON.stringify(pricing, null, 2) + '\n';

let oldJson = '';
try { oldJson = fs.readFileSync(outFile, 'utf8'); } catch {}

if (oldJson !== newJson) {
  fs.writeFileSync(outFile, newJson, 'utf8');
  console.log(`[pricing-sync] wrote ${path.relative(repoRoot, outFile)}`);

  try {
    // best-effort git commit & push (runner has contents:write)
    execSync('git config user.email "bot@cg-alert.com"', { stdio: 'inherit' });
    execSync('git config user.name "cg-alert-bot"', { stdio: 'inherit' });
    execSync(`git add "${outFile}"`, { stdio: 'inherit' });
    execSync('git diff --cached --quiet || git commit -m "pricing: sync tiers (portfolio/business only; enterprise via form)"', { shell: '/usr/bin/bash', stdio: 'inherit' });
    try { execSync('git pull --rebase --autostash', { stdio: 'inherit' }); } catch {}
    execSync('git push', { stdio: 'inherit' });
    console.log('[pricing-sync] committed & pushed changes');
  } catch (e) {
    console.warn('[pricing-sync] git commit/push failed (non-fatal).');
  }
} else {
  console.log('[pricing-sync] no changes needed');
}

// Print summary for logs
console.log(JSON.stringify(pricing, null, 2));
