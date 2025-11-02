#!/usr/bin/env node
// scripts/patch_pricing_config.js
// Patch pricing/config.json to align naming, delivery wording, and enterprise price label.
const fs = require('fs'); const path = require('path');
const p = path.join(process.cwd(), 'pricing', 'config.json');
if (!fs.existsSync(p)) { console.error('pricing/config.json not found'); process.exit(1); }
const j = JSON.parse(fs.readFileSync(p,'utf8'));
if (!Array.isArray(j.plans)) { console.error('plans missing'); process.exit(1); }

for (const plan of j.plans) {
  const id = String(plan.id||'');
  if (id === 'portfolio') {
    plan.name = 'Portfolio';
    plan.tagline = 'Up to 25 vendors. Weekly. Delivery: Email (default) or Slack (single‑channel).';
  } else if (id === 'renewal_desk') {
    plan.name = 'Business';
    plan.tagline = 'Up to 50 vendors. Daily/Weekly. Delivery: Email + Slack.';
  } else if (id === 'enterprise') {
    plan.name = 'Enterprise';
    plan.price_usd_year = 18000;
    plan.price_label = 'Starts $18,000+ / yr';
    plan.tagline = 'Up to 200 vendors. Custom cadence. Delivery: Email (default) + optional Slack / SIEM.';
  }
}
fs.writeFileSync(p, JSON.stringify(j, null, 2));
console.log('pricing/config.json patched');
