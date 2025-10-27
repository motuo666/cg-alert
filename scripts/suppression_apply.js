#!/usr/bin/env node
/**
 * suppression_apply.js
 *
 * Merge bounces / complaints / unsubscribes into leads.csv status=suppress.
 * Safe, idempotent.
 */

const fs = require("fs");
const path = require("path");

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

(function main(){
  fs.mkdirSync("data",{recursive:true});
  const leadsPath = path.join("data","leads.csv");
  if (!fs.existsSync(leadsPath)) {
    fs.writeFileSync(leadsPath, "email,name,title,company,domain,region,status\n","utf8");
  }

  const leads = readCsv(leadsPath);
  const unsub = readCsv(path.join("data","unsubscribes.csv")).map(r=>r.email.toLowerCase());
  const bounces = readCsv(path.join("data","bounces.csv")).map(r=>r.email.toLowerCase());
  const complaints = readCsv(path.join("data","complaints.csv")).map(r=>r.email.toLowerCase());

  const suppressSet = new Set([...unsub,...bounces,...complaints].filter(Boolean));

  for (const row of leads) {
    if (row.email && suppressSet.has(row.email.toLowerCase())) {
      row.status = "suppress";
    }
  }

  writeCsv(leadsPath, leads, ["email","name","title","company","domain","region","status"]);
  console.log("[suppression_apply] applied suppression to leads.csv");
})();
