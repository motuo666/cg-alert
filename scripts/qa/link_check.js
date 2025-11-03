#!/usr/bin/env node
/**
 * scripts/qa/link_check.js
 * Scan HTML files for internal links that don't resolve to a local file.
 * Output: artifacts/link_report.json + artifacts/link_report.txt
 * Exit 1 if any broken internal links are found.
 */
const fs = require('fs');
const path = require('path');

function walk(dir) {
  const res = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) res.push(...walk(p));
    else if (/\.(html?)$/i.test(e.name)) res.push(p);
  }
  return res;
}

function extractHrefs(html) {
  const hrefs = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["']/ig;
  let m; 
  while ((m = re.exec(html))) hrefs.push(m[1]);
  return hrefs;
}

const ROOT = process.cwd();
const broken = [];
const all = walk(ROOT);
for (const f of all) {
  const html = fs.readFileSync(f, 'utf8');
  const hrefs = extractHrefs(html);
  for (const h of hrefs) {
    if (/^(https?:|mailto:|tel:|#)/i.test(h)) continue;
    // local link: resolve relative to file
    let target = h;
    if (h.startsWith('/')) target = path.join(ROOT, h.replace(/^\//,''));
    else target = path.join(path.dirname(f), h);
    target = target.split('#')[0].split('?')[0];
    if (!fs.existsSync(target)) {
      broken.push({ file: path.relative(ROOT, f), href: h });
    }
  }
}

fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/link_report.json', JSON.stringify({ broken }, null, 2));
fs.writeFileSync('artifacts/link_report.txt', broken.map(b => `${b.file} -> ${b.href}`).join('\n'));
console.log('link_check: broken internal links =', broken.length);
if (broken.length > 0) process.exit(1);
