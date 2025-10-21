import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';

const MAX_HOURS = parseInt(process.env.HB_MAX_HOURS || '26', 10);
const p = path.join(process.cwd(),'artifacts','daily_ops.json');

let ok = false, msg = '';
if (fs.existsSync(p)) {
  try {
    const j = JSON.parse(fs.readFileSync(p,'utf-8'));
    const dt = j?.date ? dayjs(j.date) : null;
    if (dt && dt.isValid()) {
      const age = dayjs().diff(dt,'hour');
      ok = age <= MAX_HOURS; msg = `Snapshot age: ${age}h (max ${MAX_HOURS}h).`;
    } else msg = 'daily_ops.json present but missing valid "date".';
  } catch (e) { msg = `Failed to parse daily_ops.json: ${String(e)}`; }
} else { msg = 'daily_ops.json not found.'; }

const summary = `## Heartbeat check
- ${msg}
${ok ? '✅ Fresh' : '❌ Stale or missing snapshot'}`;
console.log(summary);
if (!ok) process.exit(1);
