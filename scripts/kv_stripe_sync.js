#!/usr/bin/env node
// scripts/kv_stripe_sync.js — dump Stripe sessions from KV to data/customers.csv
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const file = 'data/customers.csv';
try{ execSync('test -f '+file+' || echo \"email,plan,amount_cents,currency,session_id,at\" > '+file, {stdio:'inherit'});}catch{}
const prev = readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean);
const seen = new Set(prev.slice(1).map(l=>l.split(',')[4])); // session_id

// Expect Cloudflare API envs provided by workflow
const acct = process.env.CF_ACCOUNT_ID, ns = process.env.KV_NAMESPACE_ID, tok = process.env.CF_API_TOKEN;
if(!acct||!ns||!tok){ console.error('CF env missing'); process.exit(1); }

function listKeys(cursor){
  const url = `https://api.cloudflare.com/client/v4/accounts/${acct}/storage/kv/namespaces/${ns}/keys?limit=1000` + (cursor?`&cursor=${cursor}`:'');
  const res = execSync(`curl -s -H "Authorization: Bearer ${tok}" -H "Content-Type: application/json" "${url}"`).toString();
  const j = JSON.parse(res);
  return j;
}

function readKey(key){
  const url = `https://api.cloudflare.com/client/v4/accounts/${acct}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`;
  const res = execSync(`curl -s -H "Authorization: Bearer ${tok}" -H "Content-Type: application/json" "${url}"`).toString();
  return res;
}

let cursor=null, added=0;
do{
  const j=listKeys(cursor);
  cursor=j.result_info && j.result_info.cursor;
  for(const k of j.result||[]){
    if(!k.name.startsWith('stripe:session:')) continue;
    if(seen.has(k.name.split(':').pop())) continue;
    const val = readKey(k.name);
    try{
      const o = JSON.parse(val);
      const row = [o.email||'', o.plan||'', o.amount_total||'', (o.currency||'').toUpperCase(), o.session_id||'', o.at||''].join(',');
      prev.push(row); added++;
    }catch{}
  }
}while(cursor);

writeFileSync(file, prev.join('\n'));
console.log('customers added:', added);
