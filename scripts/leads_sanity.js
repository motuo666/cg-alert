// leads 健康度检查：表头、邮箱合法性、domain 归一化、重复、空行
const fs=require('fs'),path=require('path'); const ROOT=path.join(__dirname,'..');
const FP=path.join(ROOT,'data','leads.csv');
function readCSV(fp){ if(!fs.existsSync(fp)) return {h:[],r:[]}; const t=fs.readFileSync(fp,'utf8').trim(); if(!t) return {h:[],r:[]};
  const [h,...rs]=t.split(/\r?\n/).filter(Boolean); const head=h.split(',').map(s=>s.trim());
  const rows=rs.map(l=>{const v=l.split(','); const o={}; head.forEach((k,i)=>o[k]=String(v[i]??'').trim()); return o;}); return {h:head,r:rows};}
function normDomain(d,e){ let x=(d||'').toLowerCase().trim(); if(!x && e) x=e.split('@')[1]||''; x=x.replace(/^https?:\/\//,'').replace(/^www\./,'').split(/[/:]/)[0]; return x; }
(function(){
  const {h, r}=readCSV(FP);
  const need=['email','company','domain','status','seq','last_touch'];
  const miss=need.filter(k=>!h.includes(k));
  if(miss.length){ console.log('FAIL: missing headers', miss.join(',')); process.exit(3); }
  let bad=0, dup=0; const seen=new Set();
  for(const row of r){
    const email=(row.email||'').toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ bad++; continue; }
    const key=email; if(seen.has(key)) dup++; else seen.add(key);
    row.domain = normDomain(row.domain, email);
  }
  console.log(`leads sanity: total=${r.length} invalid=${bad} dup=${dup}`);
  if(bad>0) console.log('HINT: 清理不合法邮箱；domain 可留空');
})();
