#!/usr/bin/env node
/**
 * scripts/qa/policy_check.js
 * Minimal site policy QA:
 *  - robots.txt present
 *  - sitemap.xml present
 *  - Each HTML has <link rel="canonical"> and <meta name="description">
 * Writes artifacts/policy_check.json and exits 0 always (warnings only).
 */
const fs = require('fs');
const path = require('path');

function walkHTML(dir) {
  const res = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) res.push(...walkHTML(p));
    else if (/\.(html?)$/i.test(e.name)) res.push(p);
  }
  return res;
}
function hasCanonical(s) { return /<link\s+[^>]*rel=["']canonical["'][^>]*>/i.test(s); }
function hasDesc(s) { return /<meta\s+[^>]*name=["']description["'][^>]*>/i.test(s); }

const ROOT = process.cwd();
const warnings = [];

if (!fs.existsSync(path.join(ROOT, 'robots.txt'))) warnings.push('robots.txt missing');
if (!fs.existsSync(path.join(ROOT, 'sitemap.xml'))) warnings.push('sitemap.xml missing');

for (const f of walkHTML(ROOT)) {
  const s = fs.readFileSync(f, 'utf8');
  if (!hasCanonical(s)) warnings.push(`canonical missing: ${path.relative(ROOT,f)}`);
  if (!hasDesc(s)) warnings.push(`meta description missing: ${path.relative(ROOT,f)}`);
}

fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/policy_check.json', JSON.stringify({ warnings }, null, 2));
console.log('policy_check: warnings =', warnings.length);
process.exit(0);
