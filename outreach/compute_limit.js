#!/usr/bin/env node
const fs = require('fs');

function loadJSON(p, def){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch(e){ return def; } }

const raw = loadJSON('artifacts/kpi_guard.json', {});
const kpi = Object.assign({sent7:0, complaints:0, bounces:0, unsub:0, complaintRate:0, breach:{}}, raw || {});

const sent7 = Number(kpi.sent7)||0;
const complaints = Number(kpi.complaints)||0;
const complaintRate = sent7>0 ? complaints/sent7 : 0;

const thr = {
  UNSUB_7D_MAX: parseFloat(process.env.UNSUB_7D_MAX || '1'),
  BOUNCE_7D_MAX: parseFloat(process.env.BOUNCE_7D_MAX || '5'),
  COMPLAINT_7D_MAX: parseFloat(process.env.COMPLAINT_7D_MAX || '0.1')
};

const breach = {
  unsub: (Number(kpi.unsub)||0) > thr.UNSUB_7D_MAX,
  bounce: (Number(kpi.bounces)||0) > thr.BOUNCE_7D_MAX,
  complaint: complaintRate > thr.COMPLAINT_7D_MAX
};

let limit = (breach.unsub || breach.bounce || breach.complaint)
  ? 0
  : parseInt(String(process.env.TARGET_SENT || '12'), 10);

if (!Number.isFinite(limit)) limit = 0;

const line = `limit=${limit}\n`;
process.stdout.write(line);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, line);
