// scripts/fix_sent_today.js — v1.3
// - Sync sent_today (prefer top-level >0, else use kpi)
// - Pretty hash_coverage from kpi.hash_ratio (0..1 or 0..100)
// - Rebuild WARN for "daily send < 8" only
// - Idempotent & tolerant of missing fields

const fs = require('fs');
const PATH = 'artifacts/daily_ops.json';

if (!fs.existsSync(PATH)) {
  console.log('fix_sent_today: no daily_ops.json, skip');
  process.exit(0);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(PATH, 'utf8'));
} catch (e) {
  console.error('fix_sent_today: invalid JSON, skip');
  process.exit(0);
}

data.kpi = data.kpi && typeof data.kpi === 'object' ? data.kpi : {};

const toNum = (v) => {
  if (v === null || v === undefined) return 0;
  const s = typeof v === 'string' ? v.replace(/[%\s,]/g, '') : v;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const round1 = (n) => Math.round(n * 10) / 10;

// 1) sent_today 同步（顶层>0优先，否则回填自 kpi）；保证两侧一致
const sentTop = toNum(data.sent_today);
const sentKpi = toNum(data.kpi.sent_today);
let fixedSent = sentTop > 0 ? sentTop : sentKpi;
if (fixedSent < 0) fixedSent = 0;
if (fixedSent > 0) {
  data.sent_today = fixedSent;
  data.kpi.sent_today = fixedSent;
}

// 2) 生成友好 hash_coverage（不覆盖原始 kpi.hash_ratio）
if (data.kpi.hash_ratio !== undefined) {
  let pct = toNum(data.kpi.hash_ratio);
  if (pct <= 1) pct *= 100;         // 支持 0..1 或 0..100 两种输入
  pct = round1(pct);
  data.kpi.hash_ratio_pct = pct;    // 例如 42.5
  data.hash_coverage = `${pct}%`;   // 顶层展示
}

// 3) 清理并重建与“发送量不足”相关 WARN（仅按 daily 的 8 封门槛）
const warn = Array.isArray(data.WARN) ? data.WARN : [];
const cleaned = warn.filter((w) => !/发送量.*低于目标|Sent.*below/i.test(w));
if (fixedSent < 8) cleaned.push(`今日发送量低于目标 ${fixedSent}/8`);
data.WARN = cleaned;

// 兜底数组
if (!Array.isArray(data.PASS)) data.PASS = [];
if (!Array.isArray(data.FAIL)) data.FAIL = [];

fs.writeFileSync(PATH, JSON.stringify(data, null, 2));
console.log(
  `fix_sent_today: date=${data.date || 'n/a'} sent_today=${fixedSent} hash_coverage=${data.hash_coverage || 'n/a'}`
);
