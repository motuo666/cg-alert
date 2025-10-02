// scripts/segment.js — tolerant v2 (CSV/TSV auto, relax columns, normalize to 6 cols)
const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");

function loadCsvRelax(p){
  if (!fs.existsSync(p)) return [];
  const t = fs.readFileSync(p, "utf8");
  const first = t.split(/\r?\n/)[0] || "";
  const delimiter = first.includes("\t") ? "\t" : ",";
  return parse(t, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,   // 允许行列数不一致
    delimiter
  });
}

function normLead(r){
  // 统一到我们要的 6 列；其余全部忽略
  const email   = (r.email   || r.Email   || "").trim().toLowerCase();
  const company = (r.company || r.Company || "").trim();
  const domain  = (r.domain  || r.Domain  || (email.split("@")[1]||"")).trim();

  // 有些人把 trials.csv 的 vendors/ts 混进来，这里直接规避
  const vendor1 = (r.vendor1 || r.Vendor1 || r.vendors || "").toString().trim();
  const vendor2 = (r.vendor2 || r.Vendor2 || "").toString().trim();
  const vendor3 = (r.vendor3 || r.Vendor3 || "").toString().trim();

  // 过滤明显不合格/被误粘贴的行
  if (!email || !email.includes("@")) return null;
  if (!company && !domain) return null;

  return { email, company, domain, vendor1, vendor2, vendor3 };
}

(function main(){
  const stage   = parseInt(process.argv[2] || "1", 10);           // 1/2/3
  const minDays = parseInt(process.argv[3] || (stage===2?3:stage===3?7:0), 10);
  const limit   = parseInt(process.argv[4] || "20", 10);

  const leadsRaw = loadCsvRelax("data/leads.csv");
  const leads = [];
  for (const r of leadsRaw){
    const n = normLead(r);
    if (n) leads.push(n);
  }
  if (leads.length === 0){
    console.error("leads.csv parsed but no valid rows; check header & delimiter");
    process.exit(1);
  }

  // sent/unsub/trial 过滤
  const unsub = loadCsvRelax("data/unsubscribes.csv").map(r => (r.email||"").toLowerCase());
  const trials= loadCsvRelax("data/trials.csv").map(r => (r.email||"").toLowerCase());
  const sent  = loadCsvRelax("data/sent_log.csv");

  const now = new Date();
  const sentBy = {};
  for (const r of sent){
    const e = (r.email||"").toLowerCase(); if (!e) continue;
    const st = (r.stage||"").toString();
    const ts = new Date(r.ts || Date.now());
    (sentBy[e] ||= { stages:new Set(), last:{} }).stages.add(st);
    sentBy[e].last[st] = ts;
  }

  const out = [];
  function daysBetween(a,b){ return (b-a)/(24*3600*1000); }

  for (const r of leads){
    const e = r.email;
    if (unsub.includes(e)) continue;
    if (trials.includes(e)) continue;

    const hist = sentBy[e] || { stages:new Set(), last:{} };
    if (stage===1){
      if (hist.stages.has("1")) continue;
      out.push(r);
    } else if (stage===2){
      if (!hist.stages.has("1") || hist.stages.has("2")) continue;
      const last1 = hist.last["1"]; if (!last1 || daysBetween(last1, now) < minDays) continue;
      out.push(r);
    } else {
      if (!hist.stages.has("2") || hist.stages.has("3")) continue;
      const last2 = hist.last["2"]; if (!last2 || daysBetween(last2, now) < minDays) continue;
      out.push(r);
    }
    if (out.length >= limit) break;
  }

  const csv = stringify(out, { header:true });
  const outPath = `data/targets_stage${stage}.csv`;
  fs.writeFileSync(outPath, csv, "utf8");
  console.log(`generated: ${outPath} rows=${out.length}`);
})();
