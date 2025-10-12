#!/usr/bin/env node
// s1_gate.js — allow send only if evidence updated within TRIGGER_WINDOW_H hours (no set-output)
const fs = require('fs');
const path = require('path');
const WINDOW_H = Number(process.env.TRIGGER_WINDOW_H || '48');

(function main () {
  const base = path.join(__dirname, '..', 'evidence');
  let latest = 0;
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(base, d.name);
      for (const f of fs.readdirSync(dir)) {
        if (!/\.json$/i.test(f)) continue;
        const mt = fs.statSync(path.join(dir, f)).mtimeMs;
        if (mt > latest) latest = mt;
      }
    }
  }
  const ok = latest && (Date.now() - latest) <= WINDOW_H * 3600 * 1000 ? '1' : '0';
  const ageH = latest ? ((Date.now() - latest) / 3600e3).toFixed(1) : '∞';
  console.log(ok === '1' ? `fresh evidence found ${ageH}h → gate=1` : `no fresh evidence in ${WINDOW_H}h → gate=0`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `ok=${ok}\n`);
})();
