\
/**
 * fix_sent_today.js
 * Ensures sent_today fields are present and optionally overridden.
 * Logs: `fix_sent_today: date=YYYY-MM-DD sent_today=NN`
 */
const fs = require('fs');
const path = require('path');

const ART_DIR = path.join(process.cwd(), 'artifacts');
const JSON_PATH = path.join(ART_DIR, 'daily_ops.json');

function main() {
  if (!fs.existsSync(JSON_PATH)) {
    console.log('snapshot_ok=0');
    return;
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  } catch {
    console.log('snapshot_ok=0');
    return;
  }
  if (!data.kpi) data.kpi = {};
  const override = process.env.SENT_TODAY_OVERRIDE;
  if (override && override !== '') {
    const n = Number(override);
    if (Number.isFinite(n)) {
      data.kpi.sent_today = n;
      data.sent_today = n;
    }
  } else {
    // ensure consistency
    if (typeof data.kpi.sent_today === 'number') {
      data.sent_today = data.kpi.sent_today;
    } else if (typeof data.sent_today === 'number') {
      data.kpi.sent_today = data.sent_today;
    } else {
      data.kpi.sent_today = 0;
      data.sent_today = 0;
    }
  }
  fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2), 'utf8');
  const date = data.date || new Date().toISOString().slice(0,10);
  const sent = data.kpi.sent_today ?? 0;
  console.log(`fix_sent_today: date=${date} sent_today=${sent}`);
  console.log('snapshot_ok=1');
}

main();
