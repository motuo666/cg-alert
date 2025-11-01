#!/usr/bin/env node
// Compute today's send limit for gradual ramp
const base = parseInt(process.env.RAMP_BASE || '12', 10);
const inc = parseInt(process.env.RAMP_WEEKLY_INCREMENT || '8', 10);
const maxv = parseInt(process.env.RAMP_MAX || '100', 10);
const start = new Date(process.env.RAMP_START_DATE || new Date().toISOString().slice(0,10)); // YYYY-MM-DD
const today = new Date();
const weeks = Math.floor((today - start) / (7*24*3600*1000));
const limit = Math.max(base, Math.min(maxv, base + weeks*inc));
console.log('limit', limit);
const out = process.env.GITHUB_OUTPUT;
if (out) require('fs').appendFileSync(out, `limit=${limit}\n`);
else console.log(String(limit));
