// Compute daily send limit: start at SEND_BASE (default 1), +1/day since CAMPAIGN_START_DATE, cap at SEND_CAP (default 100).
// Output to GITHUB_OUTPUT as SEND_LIMIT
const { fs } = require('./utils.js');

const start = new Date(process.env.CAMPAIGN_START_DATE || new Date().toISOString().slice(0,10));
const base = parseInt(process.env.SEND_BASE || '1', 10);
const cap  = parseInt(process.env.SEND_CAP  || '100', 10);
const target = parseInt(process.env.TARGET_SENT || '0', 10);

const days = Math.max(0, Math.floor((Date.now() - start.getTime())/(24*3600*1000)));
let limit = Math.min(cap, base + days);
if(target>0) limit = Math.max(limit, target); // allow bootstrap

const out = process.env.GITHUB_OUTPUT;
if(out){
  require('node:fs').appendFileSync(out, `SEND_LIMIT=${limit}\n`);
}
console.log('SEND_LIMIT', limit);
