// scripts/acceptance_check.js  (Node 20 / ESM)
import fs from 'node:fs';
import path from 'node:path';

const today = new Date().toISOString().slice(0,10); // UTC YYYY-MM-DD
const artifactsDir = 'artifacts';
const dailyJson = path.join(artifactsDir, 'daily_ops.json');
const accJson   = path.join(artifactsDir, 'acceptance.json');
const accMd     = path.join(artifactsDir, 'acceptance.md');
fs.mkdirSync(artifactsDir, { recursive: true });

// 小工具：把字符串/百分号安全转数字
const toNum = (v, def=0) => {
  if (v === null || v === undefined) return def;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim().replace(/%$/, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : def;
  }
  return def;
};

// 从对象按“别名列表”取第一个可用值
const pick = (obj, keys, def=0) => {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null) {
      return obj[k];
    }
  }
  return def;
};

// 1) 读 Daily Ops（兼容字段名 & 字符串/%）
let daily = {};
if (fs.existsSync(dailyJson)) {
  try {
    daily = JSON.parse(fs.readFileSync(dailyJson, 'utf8'));
  } catch {
    daily = {};
  }
}

const kpi = {
  date: pick(daily, ['date'], today),
  // evidence_today 可能叫 evidence_today / evidence_count / evidence / evidence_today_count
  evidence_today: toNum(pick(daily, ['evidence_today','evidence_count','evidence','evidence_today_count'], 0)),
  // sent_today 可能是字符串，fix_sent_today.js 会已纠偏，但这里仍兜底
  sent_today: toNum(pick(daily, ['sent_today','sent'], 0)),
  // hash 覆盖：daily 用 hash_coverage，这里统一映射到 hash_ratio
  hash_ratio: toNum(pick(daily, ['hash_ratio','hash_coverage'], 0)),
  // TTD 指标名兼容
  ttd_p95: toNum(pick(daily, ['ttd_p95','TTD_P95','ttdP95'], 0)),
  ttd_samples: toNum(pick(daily, ['ttd_samples','ttd_n','ttdSamples'], 0)),
  // changed vendors
  changed_vendors_72h: toNum(pick(daily, ['changed_vendors_72h','changed_vendors','changed_vendors_last_72h'], 0)),
};

// 2) 无论是否有工件，**总是**从 sent_log.csv 纠偏 sent_today（取更大者，保证“发了≠统计”不再出现）
const sentCsv = 'data/sent_log.csv';
if (fs.existsSync(sentCsv)) {
  try {
    const lines = fs.readFileSync(sentCsv,'utf8').trim().split(/\r?\n/);
    if (lines.length > 1) {
      const rows = lines.slice(1);
      const csvCount = rows.filter(l => l.startsWith(today)).length;
      if (csvCount > kpi.sent_today) kpi.sent_today = csvCount;
    }
  } catch {}
}

// 3) 判定（400k 节奏阈值）
const passDaily   = kpi.evidence_today >= 30 && kpi.sent_today >= 40;
const passQuality = kpi.hash_ratio >= 40;         // 已把 % 去掉
const passTTD     = (kpi.ttd_samples >= 10) ? (kpi.ttd_p95 <= 24) : true; // 样本<10 → Burn-in 放行
const passChange  = (kpi.changed_vendors_72h > 0);
const ok = passDaily && passQuality && passTTD && passChange;

// 4) 控制台输出（方便在 Logs 里直观看数）
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

// 5) 写 artifacts/acceptance.json（结构化）
const acc = {
  ...kpi,
  passDaily, passQuality, passTTD, passChange, ok,
  note: ok ? 'PASS (400k cadence)' : 'WARN (below 400k cadence)',
};
fs.writeFileSync(accJson, JSON.stringify(acc, null, 2));

// 6) 写 artifacts/acceptance.md（供 Step Summary 拼接）
const md = `
### Auto Acceptance (UTC)

| Metric                  | Value            | Target   | Status |
|------------------------|-----------------:|---------:|:------:|
| Evidence today         | ${kpi.evidence_today} | ≥30      | ${kpi.evidence_today>=30 ? '✅' : '❌'} |
| Sent today             | ${kpi.sent_today} | ≥40      | ${kpi.sent_today>=40 ? '✅' : '❌'} |
| Hash coverage          | ${kpi.hash_ratio}% | ≥40%     | ${kpi.hash_ratio>=40 ? '✅' : '❌'} |
| TTD (P95, hours)       | ${kpi.ttd_p95} (n=${kpi.ttd_samples}) | ≤24* | ${(kpi.ttd_samples>=10?kpi.ttd_p95<=24:true) ? '✅' : '❌'} |
| Changed vendors (72h)  | ${kpi.changed_vendors_72h} | >0       | ${kpi.changed_vendors_72h>0 ? '✅' : '❌'} |

_* 若样本 <10，进入 Burn-in 放行。_

**Result:** ${ok ? '✅ PASS (400k cadence)' : '⚠️ WARN (below 400k cadence)'}
`.trim() + '\n';
fs.writeFileSync(accMd, md);

// 永远退出 0，不阻断流水
process.exit(0);
