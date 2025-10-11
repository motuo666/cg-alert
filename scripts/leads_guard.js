#!/usr/bin/env node
// scripts/leads_guard.js — 9列 & 去表头残片
const fs = require('fs'); const path = require('path');
const CSV = path.join(__dirname,'..','data','leads.csv');

function read(fp){
  if(!fs.existsSync(fp)) return [];
  const raw=fs.readFileSync(fp,'utf8').trim();
  if(!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean);
}
function write(fp, lines){ fs.writeFileSync(fp, lines.join('\n')+'\n', 'utf8'); }

const lines = read(CSV);
const out = [];
const okStatus = new Set(['','new','sent','bounced','unsub','invalid','bad-mx']);

for (const line of lines){
  const lower = line.toLowerCase();
  // 丢弃任何“包含 email,company,domain”的表头/残片
  if (lower.includes('email,company,domain')) continue;

  const v = line.split(',').map(s=>s.trim());
  // 固定 9 列
  const c = v.slice(0,9); while(c.length<9) c.push('');

  // 只接受 status 合法值
  if (!okStatus.has((c[7]||'').toLowerCase())) c[7]='new';

  out.push(c.join(','));
}

write(CSV, out);
console.log(`leads_guard: in=${lines.length} out=${out.length}`);
