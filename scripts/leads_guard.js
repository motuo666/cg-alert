#!/usr/bin/env node
/**
 * leads_guard.js — v2
 * 作用：把抑制（unsub/bounce/complaint）统一同步进 data/leads.csv 的 status 字段。
 * 来源：unsubscribes.csv、bounces.csv、complaints.csv、suppression_log.csv（可选）。
 * 要求：leads.csv 为 9 列；第8列 status、第9列 mx_ok。
 */
const fs = require('fs');
const path = require('path');

const D = p => path.join(process.cwd(), p);
const CSV = f => fs.existsSync(D(f)) ? fs.readFileSync(D(f), 'utf8').split(/\r?\n/).filter(Boolean) : [];

function setFromCsv(lines, type){
  const out = new Set();
  for(const ln of lines){
    const cols = ln.split(',');
    if(!cols.length) continue;
    const email = (cols[0]||'').toLowerCase().trim();
    if(!email) continue;
    // suppression_log.csv 可能第二列就是 status
    const status = (cols[1]||'').toLowerCase().trim();
    if(type==='auto'){
      if(status==='complaint') out.add(email+'|complaint');
      else if(status==='bounced' || status==='bounce') out.add(email+'|bounced');
      else if(status==='unsub' || status==='unsubscribed' || status==='unsubscribes') out.add(email+'|unsub');
    } else {
      out.add(email+'|'+type);
    }
  }
  return out;
}

const unsub = setFromCsv(CSV('data/unsubscribes.csv'), 'unsub');
const bounc = setFromCsv(CSV('data/bounces.csv'),       'bounced');
const compl = setFromCsv(CSV('data/complaints.csv'),    'complaint');
const suppl = setFromCsv(CSV('data/suppression_log.csv'),'auto'); // 兼容日志汇总

// 汇总为 email -> strongest status（complaint > bounced > unsub）
const priority = { complaint:3, bounced:2, unsub:1 };
const suppressed = new Map();
for(const set of [unsub,bounc,compl,suppl]){
  for(const key of set){
    const [email, st] = key.split('|');
    const prev = suppressed.get(email);
    if(!prev || priority[st] > priority[prev]) suppressed.set(email, st);
  }
}

const leadsPath = D('data/leads.csv');
if(!fs.existsSync(leadsPath)) {
  console.error('leads_guard: data/leads.csv not found');
  process.exit(0);
}
const rows = fs.readFileSync(leadsPath,'utf8').split(/\r?\n/).filter(Boolean).map(x=>x.split(','));

let updated=0, total=0;
const out = rows.map(cols=>{
  if(!cols || cols.length<9) return cols;
  total++;
  const email = (cols[0]||'').toLowerCase().trim();
  const cur   = (cols[7]||'new').toLowerCase().trim();
  const mxok  = cols[8]||'1';
  const target = suppressed.get(email);
  let next = cur;
  if(target){
    if(target==='complaint') next='complaint';
    else if(target==='bounced') next='bounced';
    else if(target==='unsub') next='unsub';
  }
  if(next!==cur){ updated++; cols[7]=next; }
  cols[8]=mxok;
  return cols;
});

fs.writeFileSync(leadsPath, out.map(r=>r.join(',')).join('\n'), 'utf8');
console.log(`leads_guard: in=${total} updated=${updated} sources={unsub:${unsub.size},bounced:${bounc.size},complaint:${compl.size},suppLog:${suppl.size}}`);
