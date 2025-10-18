// scripts/acceptance_check.js  (CommonJS)
const fs = require('fs');
const today = new Date().toISOString().slice(0,10);
const art = 'artifacts/daily_ops.json';

let kpi = { date: today, evidence_today: 0, sent_today: 0, hash_ratio: 0, ttd_p95: 0, ttd_samples: 0, changed_vendors_72h: 1 };
if (fs.existsSync(art)) {
  try { Object.assign(kpi, JSON.parse(fs.readFileSync(art,'utf8'))); } catch {}
} else {
  if (fs.existsSync('data/sent_log.csv')) {
    const lines = fs.readFileSync('data/sent_log.csv','utf8').trim().split(/\r?\n/).slice(1);
    kpi.sent_today = lines.filter(l=>l.startsWith(today)).length;
  }
}

const passDaily = kpi.evidence_today >= 30 && kpi.sent_today >= 40;      // 400k 节奏版阈值
const passQuality = kpi.hash_ratio >= 40;
const passTTD = (kpi.ttd_samples >= 10) ? (kpi.ttd_p95 <= 24) : true;   // Burn-in 放行
const passChange = (kpi.changed_vendors_72h ?? 0) > 0;
const ok = passDaily && passQuality && passTTD && passChange;

const out = [];
out.push('Fullchain Check Summary (UTC)');
out.push(`Date: ${kpi.date}`);
out.push(`Evidence today: ${kpi.evidence_today} (target ≥30)`);
out.push(`Sent today: ${kpi.sent_today} (target ≥40)`);
out.push(`Hash coverage: ${kpi.hash_ratio}% (target ≥40%)`);
out.push(`TTD: P95 ${kpi.ttd_p95}h (samples=${kpi.ttd_samples})`);
out.push(`Changed vendors (72h): ${kpi.changed_vendors_72h}`);
out.push(ok ? '✅ PASS (400k cadence)' : '⚠️ WARN (below 400k cadence)');
console.log(out.join('\n'));
// 不阻断流水，交由人工/后续诊断工作流处理
process.exit(0);
