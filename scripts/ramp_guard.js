// scripts/ramp_guard.js
/**
 * Decide to raise ramp max from 80 -> 120 based on health.
 * Inputs: data/metrics/summary.csv & summary.json; thresholds: bounce<3%, unsub<1%, sent>1000 last 30 days
 * For simplicity we take suppressions/leads as proxies. You can plug real rates later.
 */
const fs = require('fs');
const path = require('path');

const cfgPath = 'config/ramp.json';
const mjson = 'data/metrics/summary.json';

function setRamp(max){
  const cfg = { max };
  fs.mkdirSync('config', {recursive:true});
  fs.writeFileSync(cfgPath, JSON.stringify(cfg,null,2));
  console.log('[ramp] max set to', max);
}

(function main(){
  let max = 80;
  try {
    const s = JSON.parse(fs.readFileSync(mjson,'utf8'));
    // naive guard: if outreach sent >= 1000 (cumulative) and suppressions/leads ratio < 0.03, then 120
    const sent = s?.outreach?.sent || 0;
    const leads = s?.leads || 1;
    const sup = s?.suppressions || 0;
    const bounceRate = (sup / Math.max(leads,1));
    if (sent >= 1000 && bounceRate < 0.03) max = 120;
  } catch {}
  setRamp(max);
})();