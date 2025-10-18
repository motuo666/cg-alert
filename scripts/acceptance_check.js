// scripts/acceptance_check.js  —— 覆盖版（Node 20 / ESM）
// 职责：1) 先生成当日快照（调用 daily_ops_report + fix_sent_today）
//       2) 统一从 artifacts/daily_ops.json 与 data/sent_log.csv 取数（CSV 优先生效）
//       3) 输出到控制台 + 直接写入 GitHub Step Summary（避免 Summary 为空）

import fs from 'node:fs';
import { execSync } from 'node:child_process';

const today = new Date().toISOString().slice(0,10); // UTC YYYY-MM-DD
const ART_PATH = 'artifacts/daily_ops.json';
const SENT_CSV = 'data/sent_log.csv';

// 便捷：往 Step Summary 里追加 Markdown（若环境支持）
function appendSummary(md) {
  const p = process.env.GITHUB_STEP_SUMMARY;
  if (!p) return;
  try { fs.appendFileSync(p, md + '\n'); } catch {}
}

// 1) 先生成/纠偏快照（无论工作流有没有调用这两个脚本，这里都做一遍）
try { execSync('node scripts/daily_ops_report.js', { stdio: 'ignore' }); } catch {}
try { execSync('node scripts/fix_sent_today.js',   { stdio: 'ignore' }); } catch {}

// 2) 读取 KPI（以 daily_ops.json 为基线）
const kpi = {
  date: today,
  evidence_today: 0,
  sent_today: 0,
  hash_ratio: 0,
  ttd_p95: 0,
  ttd_samples: 0,
  changed_vendors_72h: 1,
};

if (fs.existsSync(ART_PATH)) {
  try {
    const obj = JSON.parse(fs.readFileSync(ART_PATH,'utf8'));
    Object.assign(kpi, obj || {});
  } catch {}
}

// 3) 总是从 sent_log.csv 纠偏 sent_today（取更大值，确保真实发送计入）
let csvSent = 0;
if (fs.existsSync(SENT_CSV)) {
  try {
    const lines = fs.readFileSync(SENT_CSV, 'utf8').trim().split(/\r?\n/).slice(1);
    // sent_log.csv 的首列为 ISO 时间戳（UTC），直接以 YYYY-MM-DD 开头判断
    csvSent = lines.filter(l => l.startsWith(today)).length;
  } catch {}
}
if ((csvSent || 0) > (kpi.sent_today || 0)) kpi.sent_today = csvSent;

// 4) 判定（400k 节奏阈值）
const passDaily   = (kpi.evidence_today >= 30) && (kpi.sent_today >= 40);
const passQuality = (kpi.hash_ratio >= 40);
const passTTD     = (kpi.ttd_samples >= 10) ? (kpi.ttd_p95 <= 24) : true; // 样本<10时 Burn-in 放行
const passChange  = (kpi.changed_vendors_72h ?? 0) > 0;
const ok = passDaily && passQuality && passTTD && passChange;

// 5) 控制台输出（便于在日志中直观看到）
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

// 6) 直接写 Step Summary（**关键修复**：不依赖 YAML 的 echo，Summary 一定有内容）
appendSummary('### Auto Acceptance (UTC)');
appendSummary([
  '',
  `- **Date**: \`${kpi.date}\``,
  `- **Evidence today**: **${kpi.evidence_today}** (target ≥30)`,
  `- **Sent today**: **${kpi.sent_today}** (target ≥40)`,
  `- **Hash coverage**: **${kpi.hash_ratio}%** (target ≥40%)`,
  `- **TTD**: P95 **${kpi.ttd_p95}h** (samples=${kpi.ttd_samples})`,
  `- **Changed vendors (72h)**: **${kpi.changed_vendors_72h}**`,
  '',
  ok ? '✅ **PASS (400k cadence)**' : '⚠️ **WARN (below 400k cadence)**',
].join('\n'));

process.exit(0);
