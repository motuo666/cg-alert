// scripts/acceptance_check.js  (ESM 兼容，Node 20)
import fs from 'node:fs';
import path from 'node:path';

const today = new Date().toISOString().slice(0,10); // UTC YYYY-MM-DD
const artifactsDir = 'artifacts';
const dailyJson = path.join(artifactsDir, 'daily_ops.json');
const accJson   = path.join(artifactsDir, 'acceptance.json');
const accMd     = path.join(artifactsDir, 'acceptance.md');
fs.mkdirSync(artifactsDir, { recursive: true });

// 读 Daily Ops（若不存在也不报错）
const kpi = {
  date: today,
  evidence_today: 0,
  sent_today: 0,
  hash_ratio: 0,
  ttd_p95: 0,
  ttd_samples: 0,
  changed_vendors_72h: 1,
};
if (fs.existsSync(dailyJson)) {
  try { Object.assign(kpi, JSON.parse(fs.readFileSync(dailyJson, 'utf8'))); } catch {}
}

// 总是从 data/sent_log.csv 纠偏 sent_today（取更大值），保证“发了≠统计”不会再出现
const sentCsv = 'data/sent_log.csv';
if (fs.existsSync(sentCsv)) {
  try {
    const lines = fs.readFileSync(sentCsv, 'utf8').trim().split(/\r?\n/);
    if (lines.length > 1) {
      const rows = lines.slice(1);
      const csvCount = rows.filter(l => l.startsWith(today)).length;
      if ((csvCount || 0) > (kpi.sent_today || 0)) kpi.sent_today = csvCount;
    }
  } catch {}
}

// 400k 节奏阈值
const passDaily   = kpi.evidence_today >= 30 && kpi.sent_today >= 40;
const passQuality = kpi.hash_ratio >= 40;
const passTTD     = (kpi.ttd_samples >= 10) ? (kpi.ttd_p95 <= 24) : true; // Burn-in 放行
const passChange  = (kpi.changed_vendors_72h ?? 0) > 0;
const ok = passDaily && passQuality && passTTD && passChange;

// 控制台输出（便于在 Logs 中一眼看到）
const lines = [
  'Fullchain Check Summary (UTC)',
  `Date: ${kpi.date}`,
  `Evidence today: ${kpi.evidence_today} (target ≥30)`,
  `Sent today: ${kpi.sent_today} (target ≥40)`,
  `Hash coverage: ${kpi.hash_ratio}% (target ≥40%)`,
  `TTD: P95 ${kpi.ttd_p95}h (samples=${kpi.ttd_samples})`,
  `Changed vendors (72h): ${kpi.changed_vendors_72h}`,
  ok ? '✅ PASS (400k cadence)' : '⚠️ WARN (below 400k cadence)',
];
console.log(lines.join('\n'));

// 写 artifacts/acceptance.json（结构化）
const acc = {
  ...kpi,
  passDaily, passQuality, passTTD, passChange, ok,
  note: ok ? 'PASS (400k cadence)' : 'WARN (below 400k cadence)',
};
fs.writeFileSync(accJson, JSON.stringify(acc, null, 2));

// 写 artifacts/acceptance.md（Markdown，供 Step Summary 直接拼接）
const md = `
### Auto Acceptance (UTC)

| Metric                  | Value            | Target   | Status |
|------------------------|-----------------:|---------:|:------:|
| Evidence today         | ${kpi.evidence_today} | ≥30      | ${passDaily ? '✅' : (kpi.evidence_today>=30?'✅':'❌')} |
| Sent today             | ${kpi.sent_today} | ≥40      | ${kpi.sent_today>=40 ? '✅' : '❌'} |
| Hash coverage          | ${kpi.hash_ratio}% | ≥40%     | ${passQuality ? '✅' : '❌'} |
| TTD (P95, hours)       | ${kpi.ttd_p95} (n=${kpi.ttd_samples}) | ≤24* | ${passTTD ? '✅' : '❌'} |
| Changed vendors (72h)  | ${kpi.changed_vendors_72h} | >0       | ${passChange ? '✅' : '❌'} |

_* 若样本 <10，进入 Burn-in 放行。_

**Result:** ${ok ? '✅ PASS (400k cadence)' : '⚠️ WARN (below 400k cadence)'}
`.trim() + '\n';
fs.writeFileSync(accMd, md);

// 永远退出 0，不阻断流水
process.exit(0);
