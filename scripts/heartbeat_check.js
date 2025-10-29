#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const MAX_HOURS = parseInt(process.env.HB_MAX_HOURS || '26', 10);
const p = path.join(process.cwd(), 'artifacts', 'daily_ops.json');

let ok = false, msg = '';
if (fs.existsSync(p)) {
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const dt = j && j.date ? dayjs(j.date) : null;
    if (dt && dt.isValid()) {
      const age = dayjs().diff(dt, 'hour');
      ok = age <= MAX_HOURS;
      msg = `Snapshot age: ${age}h (max ${MAX_HOURS}h)`;
    } else {
      msg = 'No valid date in daily_ops.json';
    }
  } catch (e) {
    msg = 'Parse error: ' + e.message;
  }
} else {
  msg = 'daily_ops.json not found';
}

if (!ok) {
  console.log('❌ Heartbeat FAIL -', msg);
  process.exit(1);
}
console.log('✅ Heartbeat OK -', msg);
