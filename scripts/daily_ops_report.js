\
/**
 * daily_ops_report.js
 * Produces artifacts/daily_ops.json snapshot.
 * If a snapshot exists, it updates minimal fields; else creates a skeleton.
 * Supports overrides via env:
 *  EVIDENCE_TODAY_OVERRIDE, SENT_TODAY_OVERRIDE, HASH_RATIO_OVERRIDE (0..1 or 0..100),
 *  CHANGED_VENDORS_72H_OVERRIDE, TTD_P95_H_OVERRIDE, TTD_SAMPLES_OVERRIDE
 */
const fs = require('fs');
const path = require('path');

const ART_DIR = path.join(process.cwd(), 'artifacts');
const JSON_PATH = path.join(ART_DIR, 'daily_ops.json');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function readExisting() {
  if (!fs.existsSync(JSON_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(JSON_PATH,'utf8')); } catch { return null; }
}

function num(v, d=0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function toRatio(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n/100 : n;
}

function main() {
  ensureDir(ART_DIR);
  const today = new Date().toISOString().slice(0,10);
  const base = readExisting() || {
    date: today,
    YM: today.slice(0,7),
    kpi: {
      endpoints: 7000,
      evidence_total: 600,
      evidence_today: 0,
      changed_vendors_72h: 0,
      hash_ratio: 0,
      ttd_samples: 0,
      ttd_p50_hours: 0,
      ttd_p95_hours: 0,
      packs_month: 50,
      sent_today: 0,
      dry_today: 0
    },
    sent_today: 0
  };

  // Apply overrides if provided
  const k = base.kpi;
  if (process.env.EVIDENCE_TODAY_OVERRIDE) k.evidence_today = num(process.env.EVIDENCE_TODAY_OVERRIDE, k.evidence_today);
  if (process.env.SENT_TODAY_OVERRIDE) { k.sent_today = num(process.env.SENT_TODAY_OVERRIDE, k.sent_today); base.sent_today = k.sent_today; }
  if (process.env.HASH_RATIO_OVERRIDE) k.hash_ratio = toRatio(process.env.HASH_RATIO_OVERRIDE);
  if (process.env.CHANGED_VENDORS_72H_OVERRIDE) k.changed_vendors_72h = num(process.env.CHANGED_VENDORS_72H_OVERRIDE, k.changed_vendors_72h);
  if (process.env.TTD_P95_H_OVERRIDE) k.ttd_p95_hours = num(process.env.TTD_P95_H_OVERRIDE, k.ttd_p95_hours);
  if (process.env.TTD_SAMPLES_OVERRIDE) k.ttd_samples = num(process.env.TTD_SAMPLES_OVERRIDE, k.ttd_samples);

  // Write JSON
  fs.writeFileSync(JSON_PATH, JSON.stringify(base, null, 2), 'utf8');

  // Console section (for Job Summary previous step)
  const pct = (k.hash_ratio<=1? Math.round(k.hash_ratio*1000)/10 : Math.round(k.hash_ratio*10)/10);
  console.log("### Daily Ops");
  console.log(`- date: **${base.date}**`);
  console.log(`- evidence_today: **${k.evidence_today}** / target 10`);
  console.log(`- sent_today: **${k.sent_today}** / target 8`);
  console.log(`- hash_coverage: **${pct}%**`);
  console.log(`- TTD: P50 **${k.ttd_p50_hours}h**, P95 **${k.ttd_p95_hours}h**, samples **${k.ttd_samples}**`);
  console.log(`- source: **artifacts/daily_ops.json**`);
}
main();
