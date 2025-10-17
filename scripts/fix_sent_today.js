// scripts/fix_sent_today.js
import fs from 'fs';

const today = new Date().toISOString().slice(0,10);
const sentCsv = 'data/sent_log.csv';
const art = 'artifacts/daily_ops.json';

let sentToday = 0;
if (fs.existsSync(sentCsv)) {
  const lines = fs.readFileSync(sentCsv, 'utf8').trim().split(/\r?\n/).slice(1);
  sentToday = lines.filter(l => l.startsWith(today)).length;
}

let obj = {};
if (fs.existsSync(art)) {
  try { obj = JSON.parse(fs.readFileSync(art,'utf8')); } catch {}
}
obj.date = today;
obj.sent_today = sentToday;

fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync(art, JSON.stringify(obj, null, 2));
console.log(`fix_sent_today: date=${today} sent_today=${sentToday}`);
