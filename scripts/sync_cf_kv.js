import fs from 'node:fs/promises';
import path from 'node:path';

const token = process.env.CF_API_TOKEN;
const accountId = process.env.CF_ACCOUNT_ID;
const namespaceId = process.env.KV_NAMESPACE_ID;
if(!token || !accountId || !namespaceId){
  console.error('Missing CF_API_TOKEN / CF_ACCOUNT_ID / KV_NAMESPACE_ID');
  process.exit(1);
}

const OUT = path.join(process.cwd(),'suppression','unsub.json');

async function listKeys(){
  const out=[];
  let cursor = null;
  while(true){
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys`);
    url.searchParams.set('prefix','unsub:');
    if(cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { 'authorization': `Bearer ${token}` }});
    const j = await res.json();
    if(!j.success) throw new Error('CF list keys failed');
    for(const k of j.result) out.push(k.name);
    if(j.result_info && j.result_info.cursor) cursor = j.result_info.cursor; else break;
  }
  return out;
}
async function getValue(key){
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { 'authorization': `Bearer ${token}` }});
  if(!res.ok) return null;
  try{ return await res.json(); }catch{ return null; }
}

(async function(){
  await fs.mkdir(path.dirname(OUT),{recursive:true});
  const keys = await listKeys();
  const emails = new Set();
  for(const k of keys){
    const val = await getValue(k);
    if(val && val.email) emails.add(val.email.toLowerCase());
  }
  await fs.writeFile(OUT, JSON.stringify({ unsub: Array.from(emails) }, null, 2), 'utf8');
  console.log('synced unsub emails', emails.size);
})().catch(e=>{ console.error(e); process.exit(1); });
