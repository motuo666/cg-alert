// intakes -> customers，自动追加 support 字段（business/enterprise=priority）
const fs=require('fs'),path=require('path'); const ROOT=path.join(__dirname,'..');
const IN=path.join(ROOT,'data','intakes.csv'); const OUT=path.join(ROOT,'data','customers.csv');

function readCSV(fp){ if(!fs.existsSync(fp)) return {h:[],r:[]}; const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return {h:[],r:[]};
  const [h,...rs]=raw.split(/\r?\n/).filter(Boolean); const head=h.split(',').map(s=>s.trim());
  const rows=rs.map(l=>{const v=l.split(','); const o={}; head.forEach((k,i)=>o[k]=String(v[i]??'').trim()); return o;}); return {h:head,r:rows}; }
function writeCSV(fp,head,rows){ const headRow=head.join(',')+'\n'; const body=rows.map(r=>head.map(k=>r[k]??'').join(',')).join('\n'); fs.writeFileSync(fp, headRow+(rows.length?body+'\n':''),'utf8');}
function planToSupport(p=''){const s=p.toLowerCase(); return (s.includes('business')||s.includes('enterprise'))?'priority':'standard';}

(function main(){
  const {h:ih, r:ir}=readCSV(IN); if(ih.length===0) return;
  const need=['id','company','email','plan','vendors','support']; const oh=[...new Set([...ih,...need])];
  const {h:ch, r:cr}=readCSV(OUT); const idx=(H,k)=>H.indexOf(k);

  // merge（去重以 id/email 为主键）
  const key=(row,H)=>`${(row[H.indexOf('id')]||'').toLowerCase()}::${(row[H.indexOf('email')]||'').toLowerCase()}`;
  const map=new Map(cr.map(r=>[key(r,ch),r]));
  for(const r of ir){
    const o={}; oh.forEach(k=>o[k]=r[ih.indexOf(k)]??'');
    o.support = planToSupport(o.plan||'');
    map.set(key(o,oh), o);
  }
  const out=[...map.values()];
  writeCSV(OUT, oh, out);
})();
