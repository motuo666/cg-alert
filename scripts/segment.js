// scripts/segment.js  —— 生成 data/targets_stage{1|2|3}.csv
const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");

function loadCsv(p){
  if (!fs.existsSync(p)) return [];
  const t = fs.readFileSync(p, "utf8");
  return parse(t, { columns:true, skip_empty_lines:true, trim:true });
}
function daysBetween(a,b){ return (b-a)/(24*3600*1000); }

(function main(){
  const stage   = parseInt(process.argv[2] || "1", 10);           // 1/2/3
  const minDays = parseInt(process.argv[3] || (stage===2?3:stage===3?7:0), 10);
  const limit   = parseInt(process.argv[4] || "20", 10);

  const leads = loadCsv("data/leads.csv");
  const unsub = loadCsv("data/unsubscribes.csv").map(r => (r.email||"").toLowerCase());
  const trials= loadCsv("data/trials.csv").map(r => (r.email||"").toLowerCase());
  const sent  = loadCsv("data/sent_log.csv");

  const now = new Date();
  const sentBy = {};
  for (const r of sent){
    const e = (r.email||"").toLowerCase();
    if (!e) continue;
    const st = (r.stage||"").toString();
    const ts = new Date(r.ts || Date.now());
    sentBy[e] ??= { stages:new Set(), last:{} };
    sentBy[e].stages.add(st);
    sentBy[e].last[st] = ts;
  }

  const out = [];
  for (const r of leads){
    const e = (r.email||"").toLowerCase();
    if (!e) continue;
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
    } else if (stage===3){
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
