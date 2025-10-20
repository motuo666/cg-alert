
// acceptance_check.js - normalized output
import fs from 'fs';

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function writeAcceptance(mdPath, m) {
  const lines = [];
  lines.push('Auto Acceptance (UTC)');
  lines.push('');
  lines.push('Metric\tValue\tTarget\tStatus');
  lines.push(`Evidence today\t${m.evidence_today}\t≥30\t${m.evidence_today>=30?'✅':'❌'}`);
  lines.push(`Sent today\t${m.sent_today}\t≥40\t${m.sent_today>=40?'✅':'❌'}`);
  lines.push(`Hash coverage\t${m.hash_coverage}\t≥40%\t${parseFloat(m.hash_coverage)>=40?'✅':'❌'}`);
  const ttdOk = (m.ttd_samples ?? 0) < 10 ? true : (m.ttd_p95_hours <= 24);
  const ttdBadge = `${m.ttd_p95_hours} (n=${m.ttd_samples??0})`;
  lines.push(`TTD (P95, hours)\t${ttdBadge}\t≤24*\t${ttdOk?'✅':'❌'}`);
  lines.push(`Changed vendors (72h)\t${m.changed_vendors_72h}\t>0\t${m.changed_vendors_72h>0?'✅':'❌'}`);
  lines.push('* n<10 → Burn-in 放行。');
  lines.push('');
  const passAll = (m.evidence_today>=30) && (m.sent_today>=40) && (parseFloat(m.hash_coverage)>=40) && (ttdOk) && (m.changed_vendors_72h>0);
  lines.push(`Result: ${passAll?'✅ PASS (400k cadence)':'❌ FAIL'}`);
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(mdPath, lines.join('\n'));
  return passAll;
}

function main() {
  const s = loadJSON('artifacts/daily_ops.json') || {};
  const k = s.kpi || {};
  const m = {
    evidence_today: Number(k.evidence_today ?? 0),
    sent_today: Number(k.sent_today ?? 0),
    hash_coverage: k.hash_ratio ? (Number(k.hash_ratio)*100).toFixed(1) : (typeof s.hash_coverage==='number' ? Number(s.hash_coverage).toFixed(1) : '0.0'),
    ttd_samples: Number(k.ttd_samples ?? 0),
    ttd_p95_hours: Number(k.ttd_p95_hours ?? 0),
    changed_vendors_72h: Number(k.changed_vendors_72h ?? 0)
  };
  const ok = writeAcceptance('artifacts/acceptance.md', m);
  console.log('Fullchain Check Summary (UTC)');
  console.log('Date:', s.date || new Date().toISOString().slice(0,10));
  console.log(`Evidence today: ${m.evidence_today} (target ≥30)`);
  console.log(`Sent today: ${m.sent_today} (target ≥40)`);
  console.log(`Hash coverage: ${m.hash_coverage}% (target ≥40%)`);
  console.log(`TTD: P95 ${m.ttd_p95_hours}h (samples=${m.ttd_samples})`);
  console.log(`Changed vendors (72h): ${m.changed_vendors_72h}`);
  console.log(ok ? '✅ PASS (400k cadence)' : '⚠️ WARN/FAIL');
}
main();
