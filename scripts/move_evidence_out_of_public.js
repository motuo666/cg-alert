#!/usr/bin/env node
// One-off migration: move from public/evidence/* -> evidence/* and fix basic links inside HTML files.
const fs = require('fs');
const path = require('path');

const src = path.join('public','evidence');
const dst = 'evidence';

if (!fs.existsSync(src)) {
  console.log('No public/evidence found; nothing to migrate.');
  process.exit(0);
}

fs.mkdirSync(dst, { recursive: true });

function copyDir(from, to){
  if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from)) {
    const a = path.join(from, e), b = path.join(to, e);
    const st = fs.statSync(a);
    if (st.isDirectory()) copyDir(a, b);
    else {
      let buf = fs.readFileSync(a);
      // rewrite links "/public/evidence/" -> "/evidence/"
      if (/\.html?$/.test(e)) {
        let s = buf.toString('utf8').replace(/\/(?:public)\/evidence\//g, '/evidence/');
        buf = Buffer.from(s, 'utf8');
      }
      fs.writeFileSync(b, buf);
    }
  }
}

copyDir(src, dst);
console.log('Migrated evidence =>', dst);

