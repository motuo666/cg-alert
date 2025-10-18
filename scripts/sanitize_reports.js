#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const REP = path.join(ROOT, 'reports');
const PROOF_BASE = 'https://www.cg-alert.com/reports/proof';

function walk(dir, acc=[]) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.isFile() && ent.name === 'index.html') acc.push(p);
  }
  return acc;
}

let touched = 0;
for (const fp of walk(REP)) {
  let s = fs.readFileSync(fp, 'utf8');
  if (s.includes('actions/runs/')) {
    // 简单粗暴地把 >run</a> 换成 >snapshot</a>，并移除 GitHub URL
    s = s.replace(/<a href="https:\/\/github\.com\/[^"]*actions\/runs\/[^"]*"[^>]*>run<\/a>/g, 'snapshot');
    fs.writeFileSync(fp, s, 'utf8');
    touched++;
  }
}
console.log(`sanitize_reports: updated ${touched} files under reports/`);
