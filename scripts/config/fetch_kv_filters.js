#!/usr/bin/env node
// scripts/config/fetch_kv_filters.js
const https = require('https'); const fs = require('fs'); const path = require('path');
const ACC = process.env.CF_ACCOUNT_ID || '';               
const KV  = process.env.KV_FILTERS_ID || process.env.KV_NAMESPACE_ID || ''; 
const TOK = process.env.CF_API_TOKEN || '';                
const BASE = ACC && KV ? `https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${KV}/values` : '';
const KEYS = [
  {key:'region_filter.json', file:'config/region_filter.json'},
  {key:'persona_rules.json', file:'config/persona_rules.json'},
  {key:'blacklist.txt',      file:'config/blacklist.txt'}
];
function get(key){ return new Promise(resolve=>{
  if(!BASE || !TOK){ resolve(null); return; }
  const url = `${BASE}/${encodeURIComponent(key)}`;
  const opt = { headers: { 'Authorization': `Bearer ${TOK}` } };
  https.get(url, opt, res=>{ let buf=''; res.setEncoding('utf8'); res.on('data',d=>buf+=d);
    res.on('end',()=>{ if(res.statusCode>=200 && res.statusCode<300) resolve(buf); else resolve(null); });
  }).on('error', ()=> resolve(null));
});}
(async function(){ let changed=0; for(const {key,file} of KEYS){ try{ const data = await get(key); if(!data) continue; const cur = fs.existsSync(file)? fs.readFileSync(file,'utf8'):''; if(cur!==data){ fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, data); changed++; console.log('updated', file); } }catch{} } console.log('kv_sync: changed', changed); fs.mkdirSync('artifacts',{recursive:true}); fs.writeFileSync('artifacts/kv_sync.txt', String(changed)); })();
