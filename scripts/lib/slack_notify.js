// scripts/lib/slack_notify.js
const fs=require('fs'),path=require('path');
const SLACK=process.env.SLACK_WEBHOOK_URL||'';
const ROOT=path.join(__dirname,'..','..');

function readCSV(fp){
  if(!fs.existsSync(fp)) return {header:[],rows:[]};
  const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return {header:[],rows:[]};
  const [h,...rs]=raw.split(/\r?\n/).filter(Boolean);
  const header=h.split(',').map(s=>s.trim());
  const rows=rs.map(l=>{const v=l.split(',');const o={};header.forEach((k,i)=>o[k]=String(v[i]??'').trim());return o;});
  return {header,rows};
}
function buildIdx(){
  const fp=path.join(ROOT,'data','customers.csv');
  const {header,rows}=readCSV(fp); const i=Object.fromEntries(header.map((k,n)=>[k,n]));
  const idx={byId:new Map(),byEmail:new Map(),byCompany:new Map()};
  for(const r of rows){
    const id=(r.id||r.customer_id||'').toLowerCase();
    const email=(r.email||'').toLowerCase();
    const company=(r.company||r.name||'').toLowerCase();
    const plan=(r.plan||r.tier||'').toLowerCase();
    const support=(r.support||'').toLowerCase();
    const rec={id,email,company,plan,support};
    if(id) idx.byId.set(id,rec); if(email) idx.byEmail.set(email,rec); if(company) idx.byCompany.set(company,rec);
  }
  return idx;
}
function isPriority(rec){
  if(!rec) return false;
  if(rec.support==='priority') return true;
  const p=rec.plan||''; return p.includes('business')||p.includes('enterprise');
}
async function notifySlack(text, ctx={}){
  let prefix=''; const idx=buildIdx(); let rec=null;
  if(ctx.customerId)      rec=idx.byId.get(String(ctx.customerId).toLowerCase())||rec;
  if(ctx.customerEmail)   rec=idx.byEmail.get(String(ctx.customerEmail).toLowerCase())||rec;
  if(ctx.customerCompany) rec=idx.byCompany.get(String(ctx.customerCompany).toLowerCase())||rec;
  if(rec && isPriority(rec)) prefix='[PRIORITY] ';
  const payload={text: prefix+text};
  if(!SLACK){ console.log('[Slack disabled] '+payload.text); return; }
  const res=await fetch(SLACK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!res.ok){ throw new Error('Slack notify failed: '+res.status+' '+await res.text().catch(()=>'')); }
}
module.exports={ notifySlack };
