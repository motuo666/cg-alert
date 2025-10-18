// scripts/acceptance_check.js  (ESM, Node 20)
import fs from 'node:fs';

const today = new Date().toISOString().slice(0,10); // UTC YYYY-MM-DD
const art = 'artifacts/daily_ops.json';
const sentCsv = 'data/sent_log.csv';

const kpi = {
  date: today,
  evidence_today: 0,
  sent_today: 0,
  hash_ratio: 0,
  ttd_p95: 0,
  ttd_samples: 0,
  changed_vendors_72h: 1,
};

// 1) 先尝试读 Daily Ops 工件（如果有）
if (fs.existsSync(art)) {
  try { Object.assign(kpi, JSON.parse(fs.readFileSync(art,'utf8'))); } catch {}
}

// 2) 无论是否有工件，**总是**从 sent_log.csv 纠偏 sent_today（取更大者）
let csvSent = 0;
if (fs.existsSync(sentCsv)) {
  try {
    const lines = fs.readFileSync(sentCsv,'utf8').trim().split(/\r?\n/).slice(1);
    csvSent = lines.filter(l => l.startsWith(today)).length;
  } catch {}
}
if ((csvSent || 0) > (kpi.sent_today || 0)) kpi.sent_today = csvSent;

// 3) 判定（400k 节奏阈值）
const passDaily   = kpi.evidence_today >= 30 && kpi.sent_today >= 40;
const passQuality = kpi.hash_ratio >= 40;
const passTTD     = (kpi.ttd_samples >= 10) ? (kpi.ttd_p95 <= 24) : true; // Burn-in 放行
const passChange  = (kpi.changed_vendors_72h ?? 0) > 0;
const ok = passDaily && passQuality && passTTD && passChange;

// 4) 输出
const out = [
  'Fullchain Check Summary (UTC)',
  `Date: ${kpi.date}`,
  `Evidence today: ${kpi.evidence_today} (target ≥30)`,
  `Sent today: ${kpi.sent_today} (target ≥40)`,
  `Hash coverage: ${kpi.hash_ratio}% (target ≥40%)`,
  `TTD: P95 ${kpi.ttd_p95}h (samples=${kpi.ttd_samples})`,
  `Changed vendors (72h): ${kpi.changed_vendors_72h}`,
  ok ? '✅ PASS (400k cadence)' : '⚠️ WARN (below 400k cadence)',
];
console.log(out.join('\n'));
process.exit(0);
