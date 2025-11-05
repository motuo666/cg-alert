// scripts/ops/log_fail.js
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
const get = (k, d='') => { const i = args.indexOf(`--${k}`); return i>=0 ? (args[i+1] || d) : d; };
const now = new Date().toISOString();
const entry = {
  ts: now,
  workflow: get('workflow', process.env.GITHUB_WORKFLOW || ''),
  run:      get('run', process.env.GITHUB_RUN_ID || ''),
  job:      get('job', process.env.GITHUB_JOB || ''),
  reason:   get('reason','').slice(0,4000),
};
try { entry.extra = JSON.parse(get('extra','{}')); } catch { entry.extra = {}; }
const outDir = path.join('reports','ops'); const outFile = path.join(outDir, 'last_fail.json');
fs.mkdirSync(outDir, { recursive: true });
let arr = []; try { arr = JSON.parse(fs.readFileSync(outFile,'utf8')); if(!Array.isArray(arr)) arr = []; } catch {}
arr.push(entry); arr = arr.slice(-50);
fs.writeFileSync(outFile, JSON.stringify(arr, null, 2));
console.log(`[log_fail] appended. total=${arr.length}`);
