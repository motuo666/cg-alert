#!/usr/bin/env node
/**
 * sync_unsub_kv.js
 *
 * Pull unsubscribes from Cloudflare KV (keys starting with "unsub:")
 * append to data/unsubscribes.csv
 *
 * Safe mode if CF vars missing: skip.
 */

const fs = require("fs");
const path = require("path");

const {
  CF_ACCOUNT_ID,
  CF_API_TOKEN,
  KV_NAMESPACE_ID
} = process.env;

function writeCsv(fp, rows, header){
  const hdr = header || Array.from(new Set(rows.flatMap(r=>Object.keys(r))));
  const out=[hdr.join(",")];
  for(const r of rows){
    out.push(hdr.map(h=>(r[h]||"").replace(/[\r\n,]/g," ")).join(","));
  }
  fs.writeFileSync(fp,out.join("\n")+"\n","utf8");
}
function readCsv(fp){
  if (!fs.existsSync(fp)) return [];
  const txt=fs.readFileSync(fp,"utf8").trim();
  if(!txt) return [];
  const lines=txt.split(/\r?\n/).filter(Boolean);
  if(!lines.length)return[];
  const hdr=lines[0].split(",");
  return lines.slice(1).map(line=>{
    const cols=line.split(",");
    const o={};
    hdr.forEach((h,i)=>o[h]=(cols[i]||"").trim());
    return o;
  });
}

async function fetchKvList(prefix) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !KV_NAMESPACE_ID) {
    console.log("[sync_unsub_kv] CF env not set, skip");
    return [];
  }
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys?prefix=${encodeURIComponent(prefix)}`;
    const resp = await fetch(url,{
      headers:{
        "Authorization":`Bearer ${CF_API_TOKEN}`,
        "Content-Type":"application/json"
      }
    });
    const json = await resp.json();
    if (!json || !json.result) return [];
    return json.result;
  } catch(e){
    console.log("[sync_unsub_kv] fetch list fail", e.message);
    return [];
  }
}

async function fetchKvValue(key){
  try{
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
    const resp = await fetch(url,{
      headers:{
        "Authorization":`Bearer ${CF_API_TOKEN}`
      }
    });
    if(!resp.ok) return null;
    const txt = await resp.text();
    return txt;
  }catch(e){
    console.log("[sync_unsub_kv] fetch value fail", key, e.message);
    return null;
  }
}

(async()=>{
  fs.mkdirSync("data",{recursive:true});
  const unsubPath = path.join("data","unsubscribes.csv");
  if (!fs.existsSync(unsubPath)) {
    fs.writeFileSync(unsubPath,"email,timestamp,source\n","utf8");
  }
  const rows = readCsv(unsubPath);
  const seen = new Set(rows.map(r=>r.email.toLowerCase()));

  const keys = await fetchKvList("unsub:");
  for (const k of keys) {
    const val = await fetchKvValue(k.name || k);
    if (!val) continue;
    let obj;
    try { obj = JSON.parse(val); } catch { continue; }
    const email = (obj.email||"").toLowerCase();
    const ts = obj.timestamp || new Date().toISOString();
    if (email && !seen.has(email)) {
      rows.push({
        email,
        timestamp: ts,
        source: "kv"
      });
      seen.add(email);
    }
  }

  writeCsv(unsubPath, rows, ["email","timestamp","source"]);
  console.log("[sync_unsub_kv] synced", rows.length, "unsubs total");
})().catch(err=>{
  console.error("[sync_unsub_kv] fatal", err);
  process.exit(0);
});
