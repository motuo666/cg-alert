// scripts/leads_sanity.js
const fs=require('fs'),path=require('path'); const FP=path.join(__dirname,'..','data','leads.csv');
function readCSV(fp){ if(!fs.existsSync(fp)) return {h:[],r:[]}; const t=fs.readFileSync(fp,'utf8').trim(); if(!t)return{h:[],r:[]};
  const [h,...rs]=t.split(/\r?\n/).filter(Boolean); const head=h.split(',').map(s=>s.trim());
  const rows=rs.map(l=>{const v=l.split(','); const o={}; head.forEach((k,i)=>o[k]=String(v[i]??'').trim()); return o;}); return {h:head,r:rows};}
(function(){
  const {h,r}=readCSV(FP);
  const need=['email','company','domain','status','seq','last_touch'];
  const miss=need.filter(k=>!h.includes(k));
  if(miss.length){ console.log('FAIL headers:', miss.join(',')); process.exit(2); }
  let bad=0,dup=0; const seen=new Set();
  for(const row of r){ const email=(row.email||'').toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad++;
    else { if(seen.has(email)) dup++; else seen.add(email); }
  }
  console.log(`leads sanity: total=${r.length} invalid=${bad} dup=${dup}`);
})();
