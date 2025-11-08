// Node: inject CSP, canonical, description across HTML files.
// Usage: node scripts/inject_head_meta.js cg-alert-main https://www.cg-alert.com "Default description..."
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2] || 'cg-alert-main';
const origin = (process.argv[3] || '').replace(/\/+$/,''); // no trailing slash
const defaultDesc = process.argv[4] || 'Evidence-backed vendor change alerts.';

function walk(dir, acc=[]) {
  for (const ent of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.isFile() && p.endsWith('.html')) acc.push(p);
  }
  return acc;
}

function canonicalFor(file) {
  const rel = file.replace(path.resolve(root), '').replace(/\\/g,'/');
  let urlPath = rel;
  if (urlPath.endsWith('/index.html')) urlPath = urlPath.slice(0, -'index.html'.length);
  if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;
  return origin + urlPath;
}

function ensure(head, tag, make) {
  if (head.includes(tag)) return head;
  return head + '\n' + make();
}

const files = walk(root);
let touched = 0;
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  // only inject if <head> present
  const m = s.match(/<head[^>]*>/i);
  if (!m) continue;
  const i = s.indexOf(m[0]) + m[0].length;
  const j = s.indexOf('</head>', i);
  if (j < 0) continue;
  let head = s.slice(i, j);
  const before = head;

  // CSP
  if (!/Content-Security-Policy/i.test(head)) {
    head = ensure(head, 'Content-Security-Policy', () => 
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; connect-src 'self' https://buy.stripe.com https://api.cg-alert.com; frame-src https://buy.stripe.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self' https://buy.stripe.com https://forms.gle;">`);
  }
  // canonical
  if (!/rel=['"]canonical['"]/i.test(head) && origin) {
    head = ensure(head, 'rel="canonical"', () => `<link rel="canonical" href="${canonicalFor(f)}">`);
  }
  // description
  if (!/name=['"]description['"]/i.test(head)) {
    head = ensure(head, 'name="description"', () => `<meta name="description" content="${defaultDesc}">`);
  }

  if (head !== before) {
    s = s.slice(0, i) + head + s.slice(j);
    fs.writeFileSync(f, s);
    touched++;
  }
}
console.log(`Hardening updated ${touched} HTML files.`);