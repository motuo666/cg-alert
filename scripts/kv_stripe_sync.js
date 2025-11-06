// Sync basic customer flags into Cloudflare KV if env present; otherwise no-op success
const { fs, path, readJSON } = require('./utils.js');

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_NS_ID = process.env.CF_KV_NAMESPACE || process.env.CF_KV_NS || process.env.KV_NAMESPACE_ID;
const DATA = path.join(process.cwd(),'customers.json');

async function putBulk(pairs){
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NS_ID}/bulk`;
  const res = await fetch(url, {
    method:'PUT',
    headers:{'Authorization':`Bearer ${CF_API_TOKEN}`,'Content-Type':'application/json'},
    body: JSON.stringify(pairs.map(([k,v])=>({key:k,value:v})))
  });
  if(!res.ok){ throw new Error('CF bulk put fail '+res.status); }
}

(async function(){
  if(!CF_API_TOKEN || !CF_ACCOUNT_ID || !CF_NS_ID){
    console.log('kv_stripe_sync: missing CF env, no-op');
    return;
  }
  const rows = await readJSON(DATA, []);
  const pairs = rows.slice(0,1000).map(c => [`cust:${(c.email||'').toLowerCase()}`, JSON.stringify({plan:c.plan||'', rhythm:c.rhythm||''})]);
  if(pairs.length) await putBulk(pairs);
  console.log('kv_stripe_sync done', pairs.length);
})().catch(e=>{ console.error(e); process.exit(1); });
