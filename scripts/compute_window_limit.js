#!/usr/bin/env node
// Compute per-window limit as floor(daily_limit * WINDOW_FRACTION)
const daily = parseInt(process.env.DAILY_LIMIT || '12', 10);
const frac = Math.max(0, Math.min(1, parseFloat(process.env.WINDOW_FRACTION || '1')));
const limit = Math.max(1, Math.floor(daily * frac));
const out = process.env.GITHUB_OUTPUT;
if (out) require('fs').appendFileSync(out, `limit=${limit}\n`);
else console.log(String(limit));
