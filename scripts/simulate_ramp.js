#!/usr/bin/env node
const base = parseInt(process.env.RAMP_BASE || '12', 10);
const weekInc = parseInt(process.env.RAMP_WEEKLY_INCREMENT || '8', 10);
const dayInc = parseInt(process.env.RAMP_DAILY_INCREMENT || '1', 10);
const maxv = parseInt(process.env.RAMP_MAX || '100', 10);
const startStr = (process.env.RAMP_START_DATE || new Date().toISOString().slice(0,10));
const start = new Date(startStr + 'T00:00:00Z');
function fmt(d){ return d.toISOString().slice(0,10); }
let d = new Date(start);
let days = 0;
console.log('date,limit');
while (true) {
  const inc = (dayInc > 0) ? (days*dayInc) : (Math.floor(days/7)*weekInc);
  const limit = Math.max(base, Math.min(maxv, base + inc));
  console.log(`${fmt(d)},${limit}`);
  if (limit >= maxv) break;
  d = new Date(d.getTime() + 24*3600*1000);
  days++;
}
