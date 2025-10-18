#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'evidence');

function walk(dir, acc=[]) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.isFile() && p.endsWith('.json')) acc.push(p);
  }
  return acc;
}

let changed = 0;
for (const fp of walk(DIR)) {
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if ('run_url' in j) { delete j.run_url; changed++; fs.writeFileSync(fp, JSON.stringify(j, null, 2)); }
  } catch {}
}
console.log(`redact_public_fields: removed run_url in ${changed} files`);
