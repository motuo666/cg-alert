import fs from 'fs';

function main() {
  const p = 'artifacts/daily_ops.json';
  if (!fs.existsSync(p)) {
    console.log("fix_sent_today: snapshot missing, skip");
    return;
  }
  const s = JSON.parse(fs.readFileSync(p,'utf-8'));
  const rootSent = typeof s.sent_today === 'number' ? s.sent_today : null;
  if (!s.kpi) s.kpi = {};
  const before = s.kpi.sent_today ?? 0;
  if (typeof rootSent === 'number') {
    s.kpi.sent_today = rootSent;
  }
  const after = s.kpi.sent_today ?? 0;
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
  console.log(`fix_sent_today: date=${s.date} sent_today=${after}`);
}
main();
