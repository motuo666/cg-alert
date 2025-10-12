#!/usr/bin/env node
// s1_gate.js — 最近是否有“新证据”（48h内）？用于触发式外呼
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVI  = path.join(ROOT, 'evidence');
const WINDOW_H = Number(process.env.TRIGGER_WINDOW_H || 48);

function newestMtime(dir){
  let t = 0;
  for (const v of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!v.isDirectory()) continue;
    const vd = path.join(dir, v.name);
    for (const f of fs.readdirSync(vd)) {
      if (!/\.json$/i.test(f)) continue;
      const st = fs.statSync(path.join(vd, f));
      if (st.mtimeMs > t) t = st.mtimeMs;
    }
  }
  return t;
}

(function main(){
  if (!fs.existsSync(EVI)) {
    console.log('no evidence dir → skip');
    process.exit(2);
  }
  const last = newestMtime(EVI);
  const ageH = (Date.now() - last) / 3600000;
  if (!last || ageH > WINDOW_H) {
    console.log(`no fresh evidence in ${WINDOW_H}h → gate=0`);
    console.log(`::set-output name=ok::0`); // 兼容旧Runner
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `ok=0\n`);
    }
    process.exit(0); // 正常退出，但表示“不要发”
  }
  console.log(`fresh evidence found ${ageH.toFixed(1)}h → gate=1`);
  console.log(`::set-output name=ok::1`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `ok=1\n`);
  }
  process.exit(0);
})();
