const fs=require('fs'),path=require('path'); const ROOT=path.join(__dirname,'..');
const SLACK=process.env.SLACK_WEBHOOK_URL||''; const THRESH=Number(process.env.UPSELL_THRESHOLD||0.8);
const fetch = global.fetch || ((...a)=>import('node-fetch').then(({default:f})=>f(...a)));
function readCSV(fp){ if(!fs.existsSync(fp)) return {header:[],rows:[]}; const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return {header:[],rows:[]};
  const [h,...rs]=raw.split(/\r?\n/).filter(Boolean); const header=h.split(',').map(s=>s.trim());
  const rows=rs.map(l=>{const v=l.split(','); const o={}; header.forEach((k,i)=>o[k]=String(v[i]??'').trim()); return o;}); return {header,rows}; }
function planCap(p=''){const s=p.toLowerCase(); if(s.includes('portfolio')) return 25; if(s.includes('business')) return 50; if(s.includes('enterprise')) return 200; return 25;}
async function notifySlack(text){ if(!SLACK){ console.log(text); return; } await fetch(SLACK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}); }
(function main(){
  const {rows:customers}=readCSV(path.join(ROOT,'data','customers.csv')); const alerts=[];
  for(const c of customers){
    const cap=planCap(c.plan||c.tier||''); if(!cap) continue;
    const used=(c.vendors||'').split(/[, \t\r\n]+/).filter(Boolean).length;
    if(used >= Math.ceil(cap*THRESH)) alerts.push(`• ${c.company||c.name||'customer'} (${c.plan}) ${used}/${cap} → 建议联系升级`);
  }
  if(alerts.length) notifySlack(`*Upsell Capacity*\n阈值=${THRESH*100}%\n`+alerts.join('\n')); else console.log('upsell: none');
})();
