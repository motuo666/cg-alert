#!/usr/bin/env node
/**
 * Compute rolling KPIs from repo CSVs / evidence folders and decide if it's safe
 * to increase daily send cap. Outputs:
 * - writes reports/metrics/rolling.json
 * - sets GITHUB_OUTPUT: ok=true|false reason=... sent7=... unsub7_pct=... bounce7_pct=... complaint7_pct=... evidence1=... evidence7_avg=...
 *
 * Inputs (ENV, all optional; defaults are sensible):
 *  MIN_SENT7_FOR_DLVR (default 120)  -- minimum 7-day sends to be statistically meaningful
 *  UNSUB_7D_MAX       (default 1.0)  -- percent
 *  BOUNCE_7D_MAX      (default 5.0)  -- percent
 *  COMPLAINT_7D_MAX   (default 0.1)  -- percent
 *  EVIDENCE_FLOOR     (default from TARGET_EVID_TODAY or 10)
 */
const fs = require('fs'), path=require('path');
function pct(a,b){return b>0? (100*a/b):0}
function loadCSV(p){
  try{
    const t=fs.readFileSync(p,'utf8').trim(); if(!t) return [];
    const [hdr,...rows]=t.split(/\r?\n/);
    const cols=hdr.split(',');
    return rows.map(r=>{
      const cells=[]; let cur='',q=false;
      for (let i=0;i<r.length;i++){
        const c=r[i];
        if (c=='"' && r[i+1]=='"'){ cur+='"'; i++; continue; }
        if (c=='"'){ q=!q; continue; }
        if (c==',' && !q){ cells.push(cur); cur=''; continue; }
        cur+=c;
      }
      cells.push(cur);
      const obj={};
      cols.forEach((k,idx)=>obj[k]=cells[idx]);
      return obj;
    });
  }catch{ return []; }
}
function isoDate(s){
  if(!s) return null;
  // accept YYYY-MM-DD or ISO ts
  const d=new Date(s);
  return isNaN(+d)? null : d;
}
function withinDays(ts, days){
  if(!ts) return false;
  const now=new Date();
  return (now - ts) <= days*24*3600*1000;
}
function countEvidence(days=1){
  const root='public/evidence';
  let groups=new Set();
  function walk(dir){
    for (const name of fs.readdirSync(dir)){
      const p=path.join(dir,name);
      const st=fs.statSync(p);
      if (st.isDirectory()){
        // match /<vendor>/<YYYY-MM-DD>T.../
        const m=p.replace(/\\/g,'/').match(/public\/evidence\/[^/]+\/(\d{4}-\d{2}-\d{2})T/);
        if (m){
          const d=new Date(m[1]);
          const now=new Date();
          const age=(now - d)/(24*3600*1000);
          if (age<=days) groups.add(p);
        }
        try{ walk(p); }catch{}
      }
    }
  }
  try{ walk(root); }catch{}
  return groups.size;
}
function average(arr){ return arr.length? (arr.reduce((a,b)=>a+b,0)/arr.length):0; }

// Load datasets
const sent = loadCSV('data/outreach_log.csv')
 .filter(r=> (r.status||'')==='sent')
 .map(r=> ({ts: isoDate(r.when)}))
 .filter(r=> !!r.ts);

const supLog = loadCSV('data/suppression_log.csv')
 .map(r=> ({ts: isoDate(r.when), new_status: r.new_status||''}))
 .filter(r=> !!r.ts);

const bounces = loadCSV('data/bounces.csv')
 .map(r=> ({ts: isoDate(r.timestamp)}))
 .filter(r=> !!r.ts);

const unsub = loadCSV('data/unsubscribes.csv')
 .map(r=> ({ts: isoDate(r.timestamp)}))
 .filter(r=> !!r.ts);

// Rolling windows
const sent7 = sent.filter(r=> withinDays(r.ts,7)).length;
const sent14= sent.filter(r=> withinDays(r.ts,14)).length;

const bounce7 = bounces.filter(r=> withinDays(r.ts,7)).length +
  supLog.filter(r=> withinDays(r.ts,7) && r.new_status==='bounced').length;

const unsub7 = supLog.filter(r=> withinDays(r.ts,7) && r.new_status==='unsub').length +
  unsub.filter(r=> withinDays(r.ts,7)).length;

const complaint7 = supLog.filter(r=> withinDays(r.ts,7) && r.new_status==='complaint').length;

// Evidence
const evidence1 = countEvidence(1);
const evidence7 = countEvidence(7);

// Thresholds
function envNum(k, def){ const v=process.env[k]; if(v===undefined||v==='') return def; const n=parseFloat(v); return isNaN(n)? def: n; }
const MIN_SENT7_FOR_DLVR = envNum('MIN_SENT7_FOR_DLVR', 120);
const UNSUB_7D_MAX = envNum('UNSUB_7D_MAX', 1.0);
const BOUNCE_7D_MAX = envNum('BOUNCE_7D_MAX', 5.0);
const COMPLAINT_7D_MAX = envNum('COMPLAINT_7D_MAX', 0.1);
const TARGET_EVID_TODAY = envNum('TARGET_EVID_TODAY', 10);
const EVIDENCE_FLOOR = envNum('EVIDENCE_FLOOR', TARGET_EVID_TODAY);

// Ratios
const unsub7_pct = pct(unsub7, Math.max(1, sent7));
const bounce7_pct = pct(bounce7, Math.max(1, sent7));
const complaint7_pct = pct(complaint7, Math.max(1, sent7));

// Decision
let reasons=[];
if (sent7 < MIN_SENT7_FOR_DLVR) reasons.push(`sent7 ${sent7} < ${MIN_SENT7_FOR_DLVR}`);
if (unsub7_pct >= UNSUB_7D_MAX) reasons.push(`unsub7_pct ${unsub7_pct.toFixed(2)}% >= ${UNSUB_7D_MAX}%`);
if (bounce7_pct >= BOUNCE_7D_MAX) reasons.push(`bounce7_pct ${bounce7_pct.toFixed(2)}% >= ${BOUNCE_7D_MAX}%`);
if (complaint7_pct >= COMPLAINT_7D_MAX) reasons.push(`complaint7_pct ${complaint7_pct.toFixed(2)}% >= ${COMPLAINT_7D_MAX}%`);
if (evidence1 < EVIDENCE_FLOOR) reasons.push(`evidence1 ${evidence1} < ${EVIDENCE_FLOOR}`);

const ok = reasons.length===0;

// Emit metrics JSON
const outDir='reports/metrics';
fs.mkdirSync(outDir, {recursive:true});
const payload={
  ts: new Date().toISOString(),
  sent7, sent14,
  unsub7, unsub7_pct, bounce7, bounce7_pct, complaint7, complaint7_pct,
  evidence1, evidence7,
  thresholds: { MIN_SENT7_FOR_DLVR, UNSUB_7D_MAX, BOUNCE_7D_MAX, COMPLAINT_7D_MAX, EVIDENCE_FLOOR },
  ok, reasons
};
fs.writeFileSync(path.join(outDir,'rolling.json'), JSON.stringify(payload,null,2));

// Set outputs
const gout=process.env.GITHUB_OUTPUT;
if (gout){
  const lines=[
    `ok=${ok}`,
    `reason=${reasons.join('; ') || 'ok'}`,
    `sent7=${sent7}`,
    `unsub7_pct=${unsub7_pct.toFixed(3)}`,
    `bounce7_pct=${bounce7_pct.toFixed(3)}`,
    `complaint7_pct=${complaint7_pct.toFixed(3)}`,
    `evidence1=${evidence1}`
  ];
  fs.appendFileSync(gout, lines.join('\n')+'\n');
}else{
  console.log(JSON.stringify(payload,null,2));
}
