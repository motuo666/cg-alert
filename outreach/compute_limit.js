#!/usr/bin/env node
const fs = require('fs');
function env(k,d=''){ const v=process.env[k]; return (v===undefined||v===null||v==='')?d:String(v); }
function loadJSON(p, def){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{ return def; } }

const kpi = loadJSON('artifacts/kpi_guard.json', { sent7:0, complaints:0, bounces:0, unsub:0, complaintRate:0, breach:{} });
const cfg = loadJSON('config/volume_policy.json', {});

// Normalize policy (support both old {base,step,min,max,guard,soft} and new {min,max,target,bounce_ceiling,spam_ceiling,...})
const base = parseInt(env('TARGET_SENT', cfg.target ?? cfg.base ?? 20), 10);
const min  = parseInt(env('OUTREACH_MIN', cfg.min ?? 10), 10);
const max  = parseInt(env('OUTREACH_MAX', cfg.max ?? Math.max(60, base)), 10);
const step = parseInt(env('OUTREACH_STEP', cfg.step ?? 10), 10);

const guard = (cfg.guard && typeof cfg.guard==='object') ? cfg.guard : {
  unsub7: parseFloat(env('UNSUB_7D_MAX', '3')),
  complaintRate: (cfg.spam_ceiling ?? 0.01),     // default 1%
  bounceRate:    (cfg.bounce_ceiling ?? 0.03)    // default 3%
};
const soft = (cfg.soft && typeof cfg.soft==='object') ? cfg.soft : {
  complaintRate: Math.min(0.07, (guard.complaintRate*0.8)+0.0005),
  bounceRate:    Math.min(0.05, (guard.bounceRate*0.8)+0.001)
};

const sent7 = Math.max(1, kpi.sent7 || 0);
const bounceRate = (kpi.bounces || 0) / sent7;
const complaintRate = kpi.complaintRate || ((kpi.complaints || 0) / sent7);

let limit = Math.max(min, Math.min(base, max));
let reason = `start=${limit}`;

// Hard guard
if (complaintRate > (guard.complaintRate ?? 0.05) || bounceRate > (guard.bounceRate ?? 0.08) || (kpi.unsub||0) > (guard.unsub7 ?? 3)) {
  limit = min; reason += ` | hard-guard → ${limit}`;
} else {
  // Soft nudges
  if (complaintRate > (soft.complaintRate ?? 0.03)) { limit = Math.max(min, limit - step); reason += ` | soft-complaint ↓ → ${limit}`; }
  if (bounceRate > (soft.bounceRate ?? 0.02)) { limit = Math.max(min, limit - step); reason += ` | soft-bounce ↓ → ${limit}`; }
  // Ramp-up heuristic for healthy + low volume
  const sentGate = parseInt(env('MIN_SENT7_FOR_DLVR', '120'), 10);
  if (kpi.sent7 < sentGate && complaintRate < 0.05 && bounceRate <= 0.02) {
    limit = Math.min(max, limit + step);
    reason += ` | low-vol healthy ↑ → ${limit}`;
  }
}

const out = process.env.GITHUB_OUTPUT || '';
const txt = `limit=${limit}\nreason=${reason}\n`;
if (out) fs.appendFileSync(out, txt);
console.log(txt);
