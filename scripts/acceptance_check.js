\
/**
 * acceptance_check.js
 * Reads artifacts/daily_ops.json and computes acceptance against targets:
 * Evidence≥30; Sent≥40; Hash coverage≥40%; TTD P95≤24h (n<10 -> Burn-in pass);
 * Changed vendors (72h)>0
 */
const fs = require('fs');
const path = require('path');

const ART_DIR = path.join(process.cwd(), 'artifacts');
const JSON_PATH = path.join(ART_DIR, 'daily_ops.json');
const ACC_PATH = path.join(ART_DIR, 'acceptance.md');

function percentify(v) {
  if (v == null || Number.isNaN(Number(v))) return 0;
  const n = Number(v);
  // If <= 1 assume ratio, else assume percentage already
  return n <= 1 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10;
}

function readOps() {
  if (!fs.existsSync(JSON_PATH)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(JSON_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function main() {
  ensureDir(ART_DIR);
  const ops = readOps() || {};
  const k = ops.kpi || {};
  const date = ops.date || new Date().toISOString().slice(0,10);

  const evidenceToday = k.evidence_today ?? ops.evidence_today ?? 0;
  const sentToday = k.sent_today ?? ops.sent_today ?? 0;
  const hashPct = percentify(k.hash_ratio ?? ops.hash_coverage ?? 0);
  const ttdP95 = k.ttd_p95_hours ?? 0;
  const ttdSamples = k.ttd_samples ?? 0;
  const changedVendors = k.changed_vendors_72h ?? ops.changed_vendors_72h ?? 0;

  const targets = {
    evidence: 30,
    sent: 40,
    hash: 40,
    ttdP95: 24,
    changed: 1
  };

  const passEvidence = evidenceToday >= targets.evidence;
  const passSent = sentToday >= targets.sent;
  const passHash = hashPct >= targets.hash;
  const passTTD = (ttdSamples < 10) ? true : (ttdP95 <= targets.ttdP95);
  const passChanged = changedVendors > 0;

  const allPass = passEvidence && passSent && passHash && passTTD && passChanged;

  const lines = [];
  lines.push('Auto Acceptance (UTC)');
  lines.push('');
  lines.push('| Metric | Value | Target | Status |');
  lines.push('|---|---:|---:|:--:|');
  lines.push(`| Evidence today | ${evidenceToday} | ≥${targets.evidence} | ${passEvidence?'✅':'❌'} |`);
  lines.push(`| Sent today | ${sentToday} | ≥${targets.sent} | ${passSent?'✅':'❌'} |`);
  lines.push(`| Hash coverage | ${hashPct}% | ≥${targets.hash}% | ${passHash?'✅':'❌'} |`);
  lines.push(`| TTD (P95, hours) | ${ttdP95} (n=${ttdSamples}) | ≤${targets.ttdP95}* | ${passTTD?'✅':'❌'} |`);
  lines.push(`| Changed vendors (72h) | ${changedVendors} | >0 | ${passChanged?'✅':'❌'} |`);
  lines.push('');
  lines.push('* n<10 → Burn-in 放行。');
  lines.push('');
  lines.push(`Result: ${allPass ? '✅ PASS (400k cadence)' : '⚠️ WARN (below 400k cadence)'}`);

  fs.writeFileSync(ACC_PATH, lines.join('\n'), 'utf8');

  console.log('Fullchain Check Summary (UTC)');
  console.log(`Date: ${date}`);
  console.log(`Evidence today: ${passEvidence ? evidenceToday : evidenceToday} (target ≥${targets.evidence})`);
  console.log(`Sent today: ${sentToday} (target ≥${targets.sent})`);
  console.log(`Hash coverage: ${hashPct}% (target ≥${targets.hash}%)`);
  console.log(`TTD: P95 ${ttdP95}h (samples=${ttdSamples})`);
  console.log(`Changed vendors (72h): ${changedVendors}`);
  console.log(allPass ? '✅ PASS (400k cadence)' : '⚠️ WARN (below 400k cadence)');
}

main();
