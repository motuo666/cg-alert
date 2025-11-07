#!/usr/bin/env node
// scripts/patch_pricing_config.js — normalize to 3 plans (Portfolio/Business/Enterprise), Email-first
const fs = require('fs'), path = require('path');
const p = path.join(process.cwd(), 'pricing', 'config.json');
if (!fs.existsSync(p)) { console.error('pricing/config.json missing'); process.exit(1); }
const j = JSON.parse(fs.readFileSync(p,'utf8'));
if (!Array.isArray(j.plans)) { console.error('plans missing'); process.exit(1); }
let plans = j.plans;

// Map/keep portfolio
for (const plan of plans) {
  if (plan.id === 'portfolio') {
    plan.name = 'Portfolio';
    plan.price_usd_year = 2988;
    plan.price_label = '$2,988 / yr';
    plan.tagline = 'Up to 25 vendors. Weekly. Delivery: Email (default). Optional Slack (single-channel).';
    if (!plan.checkout_redirect) plan.checkout_redirect = '/buy/portfolio';
  }
}

// Rename renewal_desk -> business
for (const plan of plans) {
  if (plan.id === 'renewal_desk') {
    plan.id = 'business';
    plan.name = 'Business';
    plan.price_usd_year = 6000;
    plan.price_label = '$6,000 / yr';
    plan.tagline = 'Up to 50 vendors. Daily/Weekly. Delivery: Email (default) + optional Slack.';
    if (!plan.checkout_redirect) plan.checkout_redirect = '/buy/business';
  }
}

// Drop compliance tier if exists
plans = plans.filter(p => p.id !== 'compliance_risk' && p.id !== 'compliance' && p.name !== 'Compliance & Vendor Risk');

// Enterprise normalize
for (const plan of plans) {
  if (plan.id === 'enterprise') {
    plan.name = 'Enterprise';
    plan.price_usd_year = 18000;
    plan.price_label = 'Starts $18,000+ / yr';
    plan.tagline = 'Up to 200 vendors. Custom cadence. Delivery: Email (default) + optional Slack / SIEM.';
    if (!plan.contact_redirect) plan.contact_redirect = '/intake';
  }
}


// Resolve Stripe checkout links for Portfolio/Business
let linkMap = {};
try {
  const linksPath = path.join(process.cwd(), 'data', 'pricing-links.json');
  if (fs.existsSync(linksPath)) linkMap = JSON.parse(fs.readFileSync(linksPath,'utf8'));
} catch {}
const envLinks = {
  portfolio: process.env.STRIPE_LINK_PORTFOLIO || '',
  business:  process.env.STRIPE_LINK_BUSINESS  || ''
};
for (const plan of plans) {
  if (plan.id === 'portfolio') {
    const val = envLinks.portfolio || linkMap.portfolio || plan.checkout_redirect || '';
    if (val) plan.checkout_redirect = val;
  }
  if (plan.id === 'business') {
    const val = envLinks.business || linkMap.business || plan.checkout_redirect || '';
    if (val) plan.checkout_redirect = val;
  }
}

j.plans = plans;
fs.writeFileSync(p, JSON.stringify(j, null, 2));
console.log('pricing/config.json normalized to 3 plans');
