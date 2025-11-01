#!/usr/bin/env node
// Pull unsub:* from Cloudflare KV into data/suppressions.csv (idempotent)
const fs = require('fs'); const path = require('path');
const ACC = process.env.CF_ACCOUNT_ID; const KV = process.env.KV_NAMESPACE_ID; const TOKEN = process.env.CF_API_TOKEN;
if(!ACC || !KV || !TOKEN){ console.log('missing CF creds; exit'); process.exit(0); }
const API = `https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${KV}`;
async function cf(p){ const r = await fetch(API+p, { headers: { 'Authorization': 'Bearer '+TOKEN } }); if(!r.ok) throw new Error('CF API '+r.status); return r; }
async function listKeys(prefix){ const r = await cf('/keys?limit=1000&prefix='+encodeURIComponent(prefix)); const j = await r.json(); return (j.result||[]).map(x=>x.name); }
async function getValue(key){ const r = await cf('/values/'+encodeURIComponent(key)); return await r.text(); }
const ROOT = process.cwd();
const csv = path.join(ROOT,'data','suppressions.csv'); if(!fs.existsSync(csv)) fs.writeFileSync(csv,'email,reason,at\n');
function append(email, reason, at){
  const line = `${email},${reason},${at}`;
  const txt = fs.readFileSync(csv,'utf8'); if (txt.includes(email+',')) return;
  fs.appendFileSync(csv, line+'\n');
}
(async()=>{
  const keys = await listKeys('unsub:');
  let n=0;
  for(const k of keys){
    const txt = await getValue(k);
    try{
      const j = JSON.parse(txt);
      const email = (j.email||'').toLowerCase();
      const at = j.at || new Date().toISOString();
      if (email) { append(email, 'unsub', at); n++; }
    }catch(e){}
  }
  console.log('unsub sync appended:', n);
})();