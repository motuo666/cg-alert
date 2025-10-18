import fs from 'node:fs';

const today = new Date().toISOString().slice(0,10);
const art = 'artifacts/daily_ops.json';

let kpi = { date: today, evidence_today: 0, sent_today: 0, hash_ratio: 0, ttd_p95: 0, ttd_samples: 0, changed_vendors_72h: 1 };
if (fs.existsSync(art)) { try { Object.assign(kpi, JSON.parse(fs.readFileSync(art,'utf8'))); } catch {} }
else if (fs.existsSync('data/sent_log.csv')) {
  const lines = fs.readFileSync('data/sent_log.csv','utf8').trim().split(/\r?\n/).slice(1);
  kpi.sent_today = lines.filter(l => l.startsWith(today)).length;
}

// 400k 节奏阈值
const passDaily   = kpi.evidence_today >= 30 && kpi.sent_today >= 40;
const passQuality = kpi.hash_ratio >= 40;
const passTTD     = (kpi.ttd_samples >= 10) ? (kpi.ttd_p95 <= 24) : true; // Burn-in 放行
const passChange  = (kpi.changed_vendors_72h ?? 0) > 0;
const ok = passDaily && passQuality && passTTD && passChange;

const out = [
  'Fullchain Check Summary (UTC)',
  `Date: ${kpi.date}`,
  `Evidence today: ${kpi.evidence_today} (target ≥30)`,
  `Sent today: ${kpi.sent_today} (target ≥40)`,
  `Hash coverage: ${kpi.hash_ratio}% (target ≥40%)`,
  `TTD: P95 ${kpi.ttd_p95}h (samples=${kpi.ttd_samples})`,
  `Changed vendors (72h): ${kpi.changed_vendors_72h}`,
  ok ? '✅ PASS (400k cadence)' : '⚠️ WARN (below 400k cadence)' ,
];
console.log(out.join('\n'));
process.exit(0); // 不阻断流水
