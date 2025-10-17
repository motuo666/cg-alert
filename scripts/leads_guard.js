#!/usr/bin/env node
/**
 * leads_guard.js — final
 * 把 unsub/bounce/complaint 同步到 leads.csv 的 status 字段（new -> unsub|bounced|complaint）
 * 并保持 mx_ok 原值。
 */

const fs = require('fs');

const leadsP = 'data/leads.csv';
const unsubP = 'data/unsubscribes.csv';
const bounceP= 'data/bounces.csv';
const complP = 'data/complaints.csv';

function readCSV(p){
  try{ return fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean).map(x=>x.split(',')); }
  catch{ return []; }
}
function writeCSV(p, rows){
  fs.writeFileSync(p, rows.map(r=>r.join(',')).join('\n'), 'utf8');
}

const leads = readCSV(leadsP);
const unsub = new Set(readCSV(unsubP).map(r=>r[0]?.toLowerCase()).filter(Boolean));
const bounc = new Set(readCSV(bounceP).map(r=>r[0]?.toLowerCase()).filter(Boolean));
const compl = new Set(readCSV(complP).map(r=>r[0]?.toLowerCase()).filter(Boolean));

let inN=0, outN=0;
const out = leads.map(r=>{
  if(!r || r.length<9) return r;
  const email = (r[0]||'').toLowerCase();
  let status = (r[7]||'new').toLowerCase();
  const mxok = r[8]||'1';

  const before=status;
  if(compl.has(email)) status='complaint';
  else if(bounc.has(email)) status='bounced';
  else if(unsub.has(email)) status='unsub';

  if(status!==before) outN++;
  inN++;
  r[7]=status; // status
  r[8]=mxok;   // mx_ok 保持
  return r;
});

writeCSV(leadsP, out);
console.log(`leads_guard: in=${inN} updated=${outN}`);
