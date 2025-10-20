import fs from 'fs';

function todayISO() { return new Date().toISOString().slice(0,10); }
function ym() { const d=new Date(); return d.toISOString().slice(0,7); }

function main() {
  fs.mkdirSync('artifacts', { recursive: true });
  const outPath = 'artifacts/daily_ops.json';
  if (!fs.existsSync(outPath)) {
    const s = {
      date: todayISO(),
      YM: ym(),
      kpi: {
        endpoints: 0,
        evidence_total: 0,
        evidence_today: 0,
        changed_vendors_72h: 0,
        hash_ratio: 0,
        ttd_samples: 0,
        ttd_p50_hours: 0,
        ttd_p95_hours: 0,
        packs_month: 0,
        sent_today: 0,
        dry_today: 0
      },
      PASS: [],
      WARN: [],
      FAIL: []
    };
    fs.writeFileSync(outPath, JSON.stringify(s, null, 2));
  }
  const snap = JSON.parse(fs.readFileSync(outPath,'utf-8'));
  console.log("### Daily Ops");
  console.log(`- date: **${snap.date}**`);
  console.log(`- evidence_today: **${snap.kpi?.evidence_today ?? 0}** / target 10`);
  console.log(`- sent_today: **${snap.kpi?.sent_today ?? 0}** / target 8`);
  const hashPct = ((snap.kpi?.hash_ratio ?? 0)*100).toFixed(1);
  console.log(`- hash_coverage: **${hashPct}%**`);
  console.log(`- TTD: P50 **${snap.kpi?.ttd_p50_hours ?? 0}h**, P95 **${snap.kpi?.ttd_p95_hours ?? 0}h**, samples **${snap.kpi?.ttd_samples ?? 0}**`);
  console.log(`- source: **artifacts/daily_ops.json**`);
}
main();
