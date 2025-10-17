// scripts/acceptance_check.js
// Node 20, 无第三方依赖
import fs from 'fs';
import path from 'path';

const ART = path.join('artifacts', 'daily_ops.json');
const utcToday = new Date().toISOString().slice(0,10); // YYYY-MM-DD (UTC)
let kpi = null;

function safeReadJSON(p){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{return null;} }

if (fs.existsSync(ART)) {
  kpi = safeReadJSON(ART);
}

if (!kpi) {
  // 极简保底：只看 sent_log.csv & evidence.ndx（若存在）
  const res = { date: utcToday, evidence_today: 0, sent_today: 0, hash_ratio: 0, ttd_p95: 0, ttd_samples: 0, changed_vendors_72h: 0 };
  try {
    if (fs.existsSync('data/sent_log.csv')) {
      const lines = fs.readFileSync('data/sent_log.csv','utf8').trim().split(/\r?\n/).slice(1);
      res.sent_today = lines.filter(l => l.startsWith(utcToday)).length;
    }
    // 其他字段如 hash_ratio/changed_vendors_72h 简化为 0（保底）
  } catch {}
  kpi = res;
}

const day = kpi.date || utcToday;
const evidence_today = kpi.evidence_today ?? 0;
const sent_today = kpi.sent_today ?? 0;
const hash_ratio = kpi.hash_ratio ?? 0;
const changed_vendors_72h = kpi.changed_vendors_72h ?? 0;
const ttd_p95 = kpi.ttd_p95 ?? 0;
const ttd_samples = kpi.ttd_samples ?? 0;

// 门槛
const passDaily = evidence_today >= 10 && sent_today >= 8;
const passQuality = hash_ratio >= 40;
const passTTD = (ttd_samples >= 10) ? (ttd_p95 <= 24) : true; // Burn-in 放行
const passChange = changed_vendors_72h > 0;

const ok = passDaily && passQuality && passTTD && passChange;

const lines = [];
lines.push('Fullchain Check Summary');
lines.push(`Date (UTC): ${day}`);
lines.push(`Evidence today: ${evidence_today}`);
lines.push(`Sent today: ${sent_today}`);
lines.push(`Hash coverage: ${hash_ratio}%`);
lines.push(`TTD: P95 ${ttd_p95}h (samples=${ttd_samples})`);
lines.push(`Changed vendors (72h): ${changed_vendors_72h}`);
lines.push(ok ? '✅ PASS' : '⚠️ WARN');
if (!passChange) lines.push('- 72h 无真实变更（changed_vendors_72h = 0）');
if (sent_today < 8) lines.push(`- sent_today ${sent_today} < 8`);
if (evidence_today < 10) lines.push(`- evidence_today ${evidence_today} < 10`);
if (!passQuality) lines.push(`- hash_ratio ${hash_ratio}% < 40%`);
if (ttd_samples >= 10 && !passTTD) lines.push(`- TTD P95 ${ttd_p95}h > 24h`);

console.log(lines.join('\n'));
