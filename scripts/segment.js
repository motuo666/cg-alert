// scripts/segment.js  — 生成分组 CSV（stage=1/2/3）
const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");

function loadCsv(path){
  if (!fs.existsSync(path)) return [];
  const t = fs.readFileSync(path, "utf8");
  return parse(t, { columns: true, skip_empty_lines: true, trim: true });
}
function daysBetween(a,b){ return (b - a) / (24*3600*1000); }

function main(){
  const stage = parseInt(process.argv[2] || "1", 10);        // 1/2/3
  const minDays = parseInt(process.argv[3] || (stage===2?3:stage===3?7:0), 10); // 与上一阶段的最小间隔
  const limit = parseInt(process.argv[4] || "20", 10);
  const leads = loadCsv("data/leads.csv");
  const unsub = loadCsv("data/unsubscribes.csv").map(r => (r.email||"").toLowerCase());
  const trials= loadCsv("data/trials.csv").map(r => (r.email||"").toLowerCase());
  const sent  = loadCsv("data/sent_log.csv"); // ts,email,stage,status,subject

  const now = new Date();

  // 建立索引：邮箱→已发阶段集合、最近一次发送时间（上一阶段）
  const sentByEmail = {};
  for (const r of sent){
    const e = (r.email||"").toLowerCase();
    if (!e) continue;
    const st = (r.stage||"").toString();
    const ts = new Date(r.ts || r.timestamp || Date.now());
    sentByEmail[e] ??= { stages:new Set(), last:{} };
    sentByEmail[e].stages.add(st);
    sentByEmail[e].last[st] = ts;
  }

  // 过滤逻辑
  const out = [];
  for (const r of leads){
    const e = (r.email||"").toLowerCase();
    if (!e) continue;
    if (unsub.includes(e)) continue;        // 已退订
    if (trials.includes(e)) continue;       // 已回“1”
    const hist = sentByEmail[e] || { stages:new Set(), last:{} };

    if (stage === 1){
      if (hist.stages.has("1")) continue;   // 已发过首封
      out.push(r);
    } else if (stage === 2){
      if (!hist.stages.has("1")) continue;  // 只给发过 1 的
      if (hist.stages.has("2")) continue;   // 不能已经发过 2
      const last1 = hist.last["1"];
      if (!last1 || daysBetween(last1, now) < minDays) continue; // 未到间隔
      out.push(r);
    } else if (stage === 3){
      if (!hist.stages.has("2")) continue;  // 只给发过 2 的
      if (hist.stages.has("3")) continue;   // 不能已经发过 3
      const last2 = hist.last["2"];
      if (!last2 || daysBetween(last2, now) < minDays) continue;
      out.push(r);
    }
    if (out.length >= limit) break;
  }

  const csv = stringify(out, { header:true });
  const outPath = `data/targets_stage${stage}.csv`;
  fs.writeFileSync(outPath, csv, "utf8");
  console.log(`generated: ${outPath} rows=${out.length}`);
}
main();
