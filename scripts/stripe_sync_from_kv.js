#!/usr/bin/env node
const fetch = globalThis.fetch;
const fs = require('fs'); const path = require('path');
const ACC = process.env.CF_ACCOUNT_ID; const KV = process.env.KV_NAMESPACE_ID; const TOKEN = process.env.CF_API_TOKEN;
const SLACK = process.env.SLACK_WEBHOOK_URL || '';
if(!ACC || !KV || !TOKEN){ console.log('missing CF creds; exit'); process.exit(0); }
const API = `https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${KV}`;
async function cf(path){ const r = await fetch(API+path, { headers: { 'Authorization': 'Bearer '+TOKEN } }); if(!r.ok) throw new Error('CF API '+r.status); return r; }
async function listKeys(prefix){ const r = await cf('/keys?limit=1000&prefix='+encodeURIComponent(prefix)); const j = await r.json(); return j.result || []; }
async function getValue(key){ const r = await cf('/values/'+encodeURIComponent(key)); return await r.text(); }
const ROOT = process.cwd();
const ordersCsv = path.join(ROOT,'data','orders.csv'); const customersCsv = path.join(ROOT,'data','customers.csv'); const statePath = path.join(ROOT,'data','stripe_sync_state.json');
function ensureHeaders(){
  if(!fs.existsSync(ordersCsv)) fs.writeFileSync(ordersCsv, 'event_id,type,email,plan,amount,ts\n');
  if(!fs.existsSync(customersCsv)) fs.writeFileSync(customersCsv, 'email,plan,amount,last_event,updated_at\n');
}
function csvAppend(p, row){ fs.appendFileSync(p, row+'\n'); }
function loadState(){ try{ return JSON.parse(fs.readFileSync(statePath,'utf8')); } catch(e){ return {done: []}; } }
function saveState(s){ fs.writeFileSync(statePath, JSON.stringify(s,null,2)); }
function setCustomer(email, plan, amount, lastEvent){
  const lines = fs.readFileSync(customersCsv,'utf8').trim().split(/\r?\n/); const head = lines.shift().split(',');
  const idx = {}; head.forEach((k,i)=>idx[k]=i);
  let found = false;
  for(let i=0;i<lines.length;i++){
    const a = lines[i].split(',');
    if ((a[idx['email']]||'').toLowerCase() === email.toLowerCase()){
      a[idx['plan']] = plan || a[idx['plan']];
      a[idx['amount']] = amount || a[idx['amount']];
      a[idx['last_event']] = lastEvent || a[idx['last_event']];
      a[idx['updated_at']] = new Date().toISOString();
      lines[i] = a.join(',');
      found = true; break;
    }
  }
  if(!found){
    lines.push([email, plan||'', amount||'', lastEvent||'', new Date().toISOString()].join(','));
  }
  fs.writeFileSync(customersCsv, (head.join(',')+'\n'+lines.join('\n')).trim()+'\n');
}
function parseRec(txt){
  try{
    const j = JSON.parse(txt);
    const rec = j.rec || {};
    let plan = rec.plan || '';
    let amount = rec.amount || '';
    if (!plan && amount){
      const cents = Number(amount);
      if (cents===298800 || cents===2988 || cents===2990) plan='Portfolio';
      else if (cents===600000 || cents===6000) plan='Business';
      else if (cents>=1800000) plan='Enterprise';
    }
    return { type: j.type || 'order', email: rec.email || '', plan, amount: String(amount||''), ts: new Date().toISOString() };
  }catch(e){ return null; }
}
(async()=>{
  ensureHeaders();
  const state = loadState();
  const keys = await listKeys('order:');
  const newKeys = keys.map(k=>k.name).filter(k=>!state.done.includes(k));
  let count=0;
  for(const key of newKeys){
    const txt = await getValue(key);
    const rec = parseRec(txt);
    if (!rec || !rec.email) continue;
    csvAppend(ordersCsv, [key.replace(/^order:/,''), rec.type, rec.email, rec.plan, rec.amount, rec.ts].join(','));
    setCustomer(rec.email, rec.plan, rec.amount, key.replace(/^order:/,''));
    state.done.push(key); count++;
  }
  saveState(state);
  console.log('stripe-sync new orders:', count);
  if (SLACK && count>0){
    await fetch(SLACK, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({text:`🧾 Synced ${count} Stripe order(s) → repo`})}).catch(()=>{});
  }
})();