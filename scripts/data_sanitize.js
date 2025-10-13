#!/usr/bin/env node
// data_sanitize.js — 清理 data/* 一致性（BOM/CRLF/空行），校验 leads.csv 9列 & 字段合法
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEADS = path.join(ROOT, 'data', 'leads.csv');

function strip(t){ return (t||'').replace(/^\uFEFF/,'').replace(/\r/g,''); }
function write(p,t){ fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, t.replace(/\n+$/,'')+'\n','utf8'); }
function sanitize(p){ if (fs.existsSync(p)) write(p, strip(fs.readFileSync(p,'utf8')).split('\n').filter(Boolean).join('\n')); }

function validateLeads(){
  if (!fs.existsSync(LEADS)) return { rows:0, fixed:0 };
  const lines = strip(fs.readFileSync(LEADS,'utf8')).split('\n').filter(Boolean);
  const statuses = new Set(['new','sent','bounced','unsub','optout','invalid','bad-mx']);
  let fixed=0;
  const out = lines.map(line=>{
    const cells = line.split(',');
    while (cells.length < 9) { cells.push(''); fixed++; }
    if (cells.length > 9) { cells.length = 9; fixed++; }
    if (!statuses.has(cells[7])) { cells[7] = 'new'; fixed++; }
    cells[8] = (cells[8] === '1') ? '1' : '0';
    return cells.join(',');
  });
  write(LEADS, out.join('\n'));
  return { rows: out.length, fixed };
}

(function main(){
  ['data/domains.csv','data/intakes.csv','data/customers.csv','data/vendor_tags.csv','data/vendor_tags_pool.csv'].forEach(f=>{
    sanitize(path.join(ROOT, f));
  });
  const vr = validateLeads();
  console.log(`[sanitize] leads rows=${vr.rows}, fixed=${vr.fixed}`);
})();
