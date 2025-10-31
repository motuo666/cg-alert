#!/usr/bin/env node
// sync_pricing.js — Node 20 safe (no generators/yield)
const fs = require('fs');
const path = require('path');

const PORTFOLIO = process.env.STRIPE_LINK_PORTFOLIO || '#';
const COMPLIANCE= process.env.STRIPE_LINK_COMPLIANCE || process.env.STRIPE_LINK_BUSINESS || '#';
const ENTERPRISE= process.env.STRIPE_LINK_ENTERPRISE || '#';
const INTAKE    = process.env.INTAKE_FORM_URL || '#';
const WORKER    = process.env.WORKER_URL || '#';

function listHtml(startDir) {
  const out = [];
  (function walk(dir){
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.') || name === 'node_modules' || name === '.git') continue;
      const fp = path.join(dir, name);
      const st = fs.statSync(fp);
      if (st.isDirectory()) walk(fp);
      else if (name.toLowerCase().endsWith('.html')) out.push(fp);
    }
  })(startDir);
  return out;
}

for (const fp of listHtml('.')) {
  const raw = fs.readFileSync(fp, 'utf8');
  let html = raw
    .replace(/\{\{STRIPE_LINK_PORTFOLIO\}\}/g, PORTFOLIO)
    .replace(/\{\{STRIPE_LINK_COMPLIANCE\}\}/g, COMPLIANCE)
    .replace(/\{\{STRIPE_LINK_ENTERPRISE\}\}/g, ENTERPRISE)
    .replace(/\{\{INTAKE_FORM_URL\}\}/g, INTAKE)
    .replace(/\{\{WORKER_URL\}\}/g, WORKER);

  // Normalize prices exactly
  html = html
    .replace(/\$\s*2[, ]?988\+?/gi, '$2,988')
    .replace(/\$\s*6[, ]?000\+?/gi, '$6,000')
    .replace(/\$\s*12[, ]?000\+?/gi, '$12,000');

  if (html !== raw) fs.writeFileSync(fp, html, 'utf8');
}
console.log('sync_pricing: OK (2,988 / 6,000 / 12,000 & CTA/WORKER injected)');
