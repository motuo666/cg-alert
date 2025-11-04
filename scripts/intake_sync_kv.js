#!/usr/bin/env node
/**
 * intake_sync_kv.js
 *
 * Pull intake form submissions from Cloudflare KV and append to intakes.csv
 * and customers.csv.
 *
 * Safe mode: if CF vars missing, exit quietly.
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

async function fetchKvList() {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !KV_NAMESPACE_ID) {
    console.log("[intake_sync_kv] CF env not set, skip");
    return [];
  }
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys?prefix=intake:`;
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
    console.log("[intake_sync_kv] fetch list fail", e.message);
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
    console.log("[intake_sync_kv] fetch value fail", key, e.message);
    return null;
  }
}

(async()=>{
  fs.mkdirSync("data",{recursive:true});
  const intakePath = path.join("data","intakes.csv");
  const custPath = path.join("data","customers.csv");

  if (!fs.existsSync(intakePath)) {
    fs.writeFileSync(intakePath,"timestamp,email,company,message\n","utf8");
  }
  if (!fs.existsSync(custPath)) {
    fs.writeFileSync(custPath,"company,email,domain,plan,timestamp\n","utf8");
  }

  const intakes = readCsv(intakePath);
  const customers = readCsv(custPath);

  const seenIntake = new Set(intakes.map(r=>r.timestamp+"|"+r.email));
  const seenCust = new Set(customers.map(r=>r.company+"|"+r.email));

  const keys = await fetchKvList();
  for (const k of keys) {
    const val = await fetchKvValue(k.name || k);
    if (!val) continue;
    let obj;
    try { obj = JSON.parse(val); } catch { continue; }
    const ts = obj.timestamp || new Date().toISOString();
    const email = (obj.email||"").toLowerCase();
    const company = obj.company || obj.org || "";
    const message = (obj.message||"").replace(/[\r\n,]/g," ");

    const intakeKey = ts+"|"+email;
    if (!seenIntake.has(intakeKey)) {
      intakes.push({
        timestamp: ts,
        email,
        company,
        message
      });
      seenIntake.add(intakeKey);
    }

    const custKey = company+"|"+email;
    if (!seenCust.has(custKey)) {
      customers.push({
        company,
        email,
        domain: (email.includes("@")?email.split("@")[1]:""),
        plan: obj.plan || "",
        timestamp: ts
      });
      seenCust.add(custKey);
    }
  }

  writeCsv(intakePath,intakes,["timestamp","email","company","message"]);
  writeCsv(custPath,customers,["company","email","domain","plan","timestamp"]);
  console.log("[intake_sync_kv] synced", keys.length, "kv keys");
})().catch(err=>{
  console.error("[intake_sync_kv] fatal", err);
  process.exit(0);
});
