// scripts/fix_sent_today.js — v1.2
const fs = require('fs');
const PATH = 'artifacts/daily_ops.json';

if (!fs.existsSync(PATH)) {
  console.log('fix_sent_today: no daily_ops.json, skip');
  process.exit(0);
}

const data = JSON.parse(fs.readFileSync(PATH, 'utf8'));
data.kpi = data.kpi || {};

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round1 = (n) => Math.round(n * 10) / 10;

// 1) 同步 sent_today：以顶层为准（如 94）
const sentTop = toNum(data.sent_today);
if (sentTop > 0) data.kpi.sent_today = sentTop;

// 2) 生成友好 hash 字段（不改原始 kpi.hash_ratio）
let pct = 0;
if (typeof data.kpi.hash_ratio === 'number') {
  pct = data.kpi.hash_ratio <= 1 ? data.kpi.hash_ratio * 100 : data.kpi.hash_ratio;
  pct = round1(pct);
  data.kpi.hash_ratio_pct = pct;   // 例如 42.5
  data.hash_coverage = `${pct}%`;  // 顶层展示
}

// 3) 清理/重建与“发送量不足”相关 WARN（仅针对 daily 的 8 封门槛）
if (Array.isArray(data.WARN)) {
  data.WARN = data.WARN.filter(w => !/发送量.*低于目标|Sent.*below/i.test(w));
} else {
  data.WARN = [];
}
const kpiSent = toNum(data.kpi.sent_today);
if (kpiSent < 8) data.WARN.push(`今日发送量低于目标 ${kpiSent}/8`);

fs.writeFileSync(PATH, JSON.stringify(data, null, 2));
console.log(`fix_sent_today: synced kpi.sent_today=${data.kpi.sent_today}, hash_coverage=${data.hash_coverage || 'n/a'}`);
