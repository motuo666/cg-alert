#!/usr/bin/env node
/**
 * monthly_checksum.js
 * 对当月 data/evidence.ndx 相关行做 sha256，输出到：
 *   reports/<YYYY-MM>/checksum.txt
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const NDX = path.join(ROOT, 'data', 'evidence.ndx');

function readLines(fp){ return fs.existsSync(fp)?fs.readFileSync(fp,'utf8').split(/\r?\n/).filter(Boolean):[]; }

function run(){
  const ym = new Date().toISOString().slice(0,7); // YYYY-MM
  const lines = readLines(NDX).filter(l => l.startsWith(ym));
  const blob = lines.join('\n');
  const sha = crypto.createHash('sha256').update(blob, 'utf8').digest('hex');

  const outDir = path.join(ROOT, 'reports', ym);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'checksum.txt');

  const txt = [
    `# Evidence monthly checksum`,
    `# Month: ${ym}`,
    `# Lines: ${lines.length}`,
    `sha256: ${sha}`,
    ''
  ].join('\n');

  fs.writeFileSync(out, txt, 'utf8');
  console.log(`monthly checksum: ${ym} lines=${lines.length} sha256=${sha.slice(0,8)}... -> ${path.relative(ROOT, out)}`);
}

run();
