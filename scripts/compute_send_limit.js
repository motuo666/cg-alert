#!/usr/bin/env node
// Compute today's send limit for gradual ramp (supports daily or weekly growth)
// Env:
//   RAMP_BASE (default 12)
//   RAMP_WEEKLY_INCREMENT (default 8)   # used when RAMP_DAILY_INCREMENT not set
//   RAMP_DAILY_INCREMENT  (optional)    # when >0, uses daily increments
//   RAMP_MAX (default 100)
//   RAMP_START_DATE (YYYY-MM-DD, default today)
const base = parseInt(process.env.RAMP_BASE || '12', 10);
const weekInc = parseInt(process.env.RAMP_WEEKLY_INCREMENT || '8', 10);
const dayInc = parseInt(process.env.RAMP_DAILY_INCREMENT || '0', 10);
const maxv = parseInt(process.env.RAMP_MAX || '100', 10);
const startStr = (process.env.RAMP_START_DATE || new Date().toISOString().slice(0,10));
const start = new Date(startStr + 'T00:00:00Z');
const now = new Date();
// Normalize to UTC midnight diff
const msPerDay = 24*3600*1000;
const days = Math.max(0, Math.floor((Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()) - Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),start.getUTCDate()))/msPerDay));
let limit;
if (dayInc > 0) {
  limit = base + days * dayInc;
} else {
  const weeks = Math.floor(days / 7);
  limit = base + weeks * weekInc;
}
limit = Math.max(base, Math.min(maxv, limit));
const out = process.env.GITHUB_OUTPUT;
if (out) require('fs').appendFileSync(out, `limit=${limit}\n`);
else console.log(String(limit));
