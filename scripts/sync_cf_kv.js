// Push suppression/unsub.json into CF KV if env present; otherwise no-op success
const { fs, path, readJSON } = require('./utils.js');

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_NS_ID = process.env.CF_KV_NAMESPACE || process.env.CF_KV_NS || process.env.KV_NAMESPACE_ID;

async function putBulk(keys){
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NS_ID}/bulk`;
  const res = await fetch(url, {
    method:'PUT',
    headers:{'Authorization':`Bearer ${CF_API_TOKEN}`,'Content-Type':'application/json'},
    body: JSON.stringify(keys.map(k=>({key:`unsub:${k}`, value:'1'})))
  });
  if(!res.ok){ throw new Error('CF bulk put fail '+res.status); }
}

(async function(){
  if(!CF_API_TOKEN || !CF_ACCOUNT_ID || !CF_NS_ID){
    console.log('sync_cf_kv: missing CF env, no-op'); return;
  }
  const unsub = await readJSON(path.join(process.cwd(),'suppression','unsub.json'), {unsub:[]});
  const list = (unsub.unsub||[]).map(x=>String(x).toLowerCase()).slice(0,5000);
  if(list.length) await putBulk(list);
  console.log('sync_cf_kv done', list.length);
})().catch(e=>{ console.error(e); process.exit(1); });
