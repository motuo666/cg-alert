#!/usr/bin/env node
/**
 * lead_enrich_sync.js
 *
 * For each domain in config/targets.csv, call ENRICH_API_URL
 * to get decision makers (CFO, compliance, RevOps, procurement).
 *
 * Append to data/leads.csv with dedupe. Mark region from targets.csv.
 *
 * Safe mode: if ENRICH_API_URL / ENRICH_API_TOKEN not set, skip.
 */

const fs = require("fs");
const path = require("path");

const { ENRICH_API_URL, ENRICH_API_TOKEN } = process.env;

function readCsv(fp) {
  if (!fs.existsSync(fp)) return [];
  const txt = fs.readFileSync(fp,"utf8").trim();
  if (!txt) return [];
  const lines = txt.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const hdr = lines[0].split(",");
  return lines.slice(1).map(line=>{
    const cols=line.split(",");
    const o={};
    hdr.forEach((h,i)=>o[h]=(cols[i]||"").trim());
    return o;
  });
}

function writeCsv(fp, rows, header){
  const hdr = header || Array.from(new Set(rows.flatMap(r=>Object.keys(r))));
  const out=[hdr.join(",")];
  for(const r of rows){
    out.push(hdr.map(h=>(r[h]||"").replace(/[\r\n,]/g," ")).join(","));
  }
  fs.writeFileSync(fp,out.join("\n")+"\n","utf8");
}

async function enrich(domain) {
  if (!ENRICH_API_URL || !ENRICH_API_TOKEN) {
    console.log("[lead_enrich_sync] enrich API not configured, skip");
    return [];
  }
  try {
    const url = ENRICH_API_URL + encodeURIComponent(domain);
    const resp = await fetch(url,{
      headers:{
        "Authorization":`Bearer ${ENRICH_API_TOKEN}`,
        "Accept":"application/json"
      }
    });
    if (!resp.ok) {
      console.log("[lead_enrich_sync] enrich resp not ok", domain, resp.status);
      return [];
    }
    const data = await resp.json();
    if (!Array.isArray(data)) return [];
    // expected shape: [{email,name,title},...]
    return data.map(x=>({
      email:(x.email||"").toLowerCase(),
      name:x.name||"",
      title:x.title||""
    })).filter(r=>r.email);
  } catch(e){
    console.log("[lead_enrich_sync] enrich fail", domain, e.message);
    return [];
  }
}

(async()=>{
  fs.mkdirSync("data",{recursive:true});
  const leadsPath = path.join("data","leads.csv");
  if (!fs.existsSync(leadsPath)) {
    fs.writeFileSync(leadsPath,"email,name,title,company,domain,region,status\n","utf8");
  }

  const leads = readCsv(leadsPath);
  const seen = new Set(leads.map(r=>r.email.toLowerCase()));
  const targets = readCsv(path.join("config","targets.csv"));

  for (const t of targets) {
    const domain = (t.domain||"").toLowerCase();
    if (!domain) continue;
    const region = (t.region||"").toLowerCase();
    const company = t.company || "";
    const enriched = await enrich(domain);
    for (const person of enriched) {
      if (seen.has(person.email.toLowerCase())) continue;
      seen.add(person.email.toLowerCase());
      leads.push({
        email: person.email,
        name: person.name,
        title: person.title,
        company: company,
        domain: domain,
        region: region || "us",
        status: ""
      });
      console.log("[lead_enrich_sync] add lead", person.email, company, domain);
    }
  }

  writeCsv(leadsPath, leads, ["email","name","title","company","domain","region","status"]);
  console.log("[lead_enrich_sync] wrote", leads.length, "total leads");
})().catch(err=>{
  console.error("[lead_enrich_sync] fatal", err);
  process.exit(0);
});
