// Computes today's SEND_LIMIT with policy: start day base + days, capped.
// Env: CAMPAIGN_START_DATE (YYYY-MM-DD, optional), SEND_BASE (default 1), SEND_CAP (default 100).
// Output: writes 'limit=N' to stdout for GitHub Actions $GITHUB_OUTPUT.

import fs from 'node:fs/promises';
import path from 'node:path';

const STATE = path.join(process.cwd(), 'state', 'campaign.json');

async function ensureDir(p){ await fs.mkdir(p,{recursive:true}); }

async function loadState(){
  try{ return JSON.parse(await fs.readFile(STATE,'utf8')); }catch{ return null; }
}
async function saveState(obj){
  await ensureDir(path.dirname(STATE));
  await fs.writeFile(STATE, JSON.stringify(obj,null,2), 'utf8');
}

(async function(){
  const base = parseInt(process.env.SEND_BASE || '1', 10);
  const cap  = parseInt(process.env.SEND_CAP  || '100', 10);
  let start  = process.env.CAMPAIGN_START_DATE;
  let state  = await loadState();
  if(!start){
    start = state?.campaign_start || new Date().toISOString().slice(0,10);
    if(!state?.campaign_start) await saveState({ campaign_start: start });
  }
  const startDate = new Date(start + "T00:00:00Z");
  const now = new Date();
  const days = Math.max(0, Math.floor((now - startDate)/86400000));
  const limit = Math.min(cap, base + days);
  process.stdout.write(`limit=${limit}\n`);
})().catch(e=>{ console.error(e); process.exit(1); });
