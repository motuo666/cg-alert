#!/usr/bin/env node
/**
 * normalize_suppression_logs.js — v2
 * 作用：把 data/suppression_log.csv 规范化并拆分生成：
 * - data/unsubscribes.csv
 * - data/bounces.csv
 * - data/complaints.csv
 * 容错：若无 when 列，补 2023-01-01T00:00:00Z；去重、按时间升序。
 * 输入容忍列序：email,status,when,notes...
 */
const fs = require('fs');

const SRC = 'data/suppression_log.csv';
const OUT = {
  unsub: 'data/unsubscribes.csv',
  bounce:'data/bounces.csv',
  comp: 'data/complaints.csv'
};

function read(p){ try{ return fs.readFileSync(p,'utf8'); } catch{ return ''; } }
function write(p, lines){ fs.writeFileSync(p, lines.join('\n'), 'utf8'); }

const raw = read(SRC).trim();
if(!raw){ console.log('normalize: suppression_log.csv not found or empty'); process.exit(0); }

const uniq = new Map(); // key=email|type -> when
const lines = raw.split(/\r?\n/).filter(Boolean);
for(const ln of lines){
  const c = ln.split(',');
  const email = (c[0]||'').toLowerCase().trim();
  const status= (c[1]||'').toLowerCase().trim();
  const when  = (c[2]||'2023-01-01T00:00:00Z').trim();
  if(!email) continue;
  let type = '';
  if(status.includes('complaint')) type='comp';
  else if(status.includes('bounce')) type='bounce';
  else if(status.includes('unsub')) type='unsub';
  else continue;

  const key = `${email}|${type}`;
  if(!uniq.has(key) || (uniq.get(key) > when)) uniq.set(key, when);
}

// 输出三份 CSV：email,when
const arr = [...uniq.entries()].map(([k,w])=>{
  const [email, type]=k.split('|');
  return {email, type, when:w};
}).sort((a,b)=> a.when.localeCompare(b.when));

const U=[], B=[], C=[];
for(const r of arr){
  const line = `${r.email},${r.when}`;
  if(r.type==='unsub') U.push(line);
  else if(r.type==='bounce') B.push(line);
  else if(r.type==='comp') C.push(line);
}

write(OUT.unsub, U);
write(OUT.bounce, B);
write(OUT.comp,  C);

console.log(`Normalize Suppression Logs
unsubscribes → ${U.length} rows
bounces      → ${B.length} rows
complaints   → ${C.length} rows`);
