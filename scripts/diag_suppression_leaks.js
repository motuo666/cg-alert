#!/usr/bin/env node
/**
 * diag_suppression_leaks.js
 * 输出仍为 status=new 但已在抑制名单中的邮箱，便于一次修正。
 */
const fs = require('fs');
function readCSV(p){ try{ return fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean).map(x=>x.split(',')); }catch{ return []; } }

const leads = readCSV('data/leads.csv');
const unsub = new Set(readCSV('data/unsubscribes.csv').map(r=>(r[0]||'').toLowerCase()));
const bounc = new Set(readCSV('data/bounces.csv').map(r=>(r[0]||'').toLowerCase()));
const compl = new Set(readCSV('data/complaints.csv').map(r=>(r[0]||'').toLowerCase()));

const leaks=[];
for(const r of leads){
  if(!r||r.length<9) continue;
  const email=(r[0]||'').toLowerCase();
  const status=(r[7]||'').toLowerCase();
  if(status==='new'){
    if(compl.has(email)) leaks.push(`${email},complaint`);
    else if(bounc.has(email)) leaks.push(`${email},bounced`);
    else if(unsub.has(email)) leaks.push(`${email},unsub`);
  }
}
if(leaks.length===0){ console.log('no suppression leaks'); }
else{
  console.log('leaks:');
  for(const x of leaks) console.log(x);
  console.log(`TOTAL: ${leaks.length}`);
}
