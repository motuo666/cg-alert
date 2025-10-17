#!/usr/bin/env node
/**
 * Daily Ops Report（final）
 * - 读取 artifacts/daily_ops.json（如无则兜底从 ndx/outreach 估算）
 * - 生成 /reports/ops/<YYYY-MM-DD>/index.html
 * - 无嵌套反引号；CSS 值合法
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'artifacts', 'daily_ops.json');
const EVID_NDX = path.join(ROOT, 'data', 'evidence.ndx');
const OUTREACH = path.join(ROOT, 'data', 'outreach_log.csv');

function readJSON(p){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{return null;} }
function readLines(p){ try{ return fs.readFileSync(p,'utf8').split(/\r?\n/);}catch{return [];} }
function todayStrUTC(){ return new Date().toISOString().slice(0,10); }
function isRealHash(h){ return !!(h && !/^0+$/i.test(String(h))); }

function fallbackKPI(){
  let evidence_today=0, total=0, hash_ok=0;
  const today = todayStrUTC();
  if (fs.existsSync(EVID_NDX)){
    for (const ln of readLines(EVID_NDX)){
      if(!ln || !ln.trim()) continue;
      const parts = ln.split('\t'); // date, vendor, type, hash, ...
      const when = (parts[0]||'').slice(0,10);
      const hash = parts[3] || '';
      if (when === today){
        evidence_today++;
        if (isRealHash(hash)) hash_ok++;
      }
      if (parts[0]) total++;
    }
  }
  const hash_ratio = total>0 ? (hash_ok/Math.max(1,total)) : 0;

  // sent_today
  let sent_today = 0;
  if (fs.existsSync(OUTREACH)){
    const todayPrefix = today + 'T';
    for (const ln of readLines(OUTREACH)){
      if (ln.startsWith(todayPrefix)) sent_today++;
    }
  }
  return { kpi:{ evidence_today, sent_today, hash_ratio, ttd_p50_hours:null, ttd_p95_hours:null, ttd_samples:0 }, date: today };
}

function bar(cur, target, label){
  const pct = Math.max(0, Math.min(100, Math.round(100*cur/Math.max(1,target))));
  return [
    '<div class="kpi">','<div class="kpi-head">',label,'</div>',
    '<div class="kpi-outer"><div class="kpi-inner" style="width:',pct,'%;"></div></div>',
    '<div class="small">',cur,' / ',target,' (',pct,'%)</div>',
    '</div>'
  ].join('');
}
function pill(text, tone){ return `<span class="pill ${tone||''}">${text}</span>`; }

function main(){
  const data = readJSON(ART) || fallbackKPI();
  const kpi = data.kpi || {};
  const date = data.date || todayStrUTC();

  const TARGET_EVIDENCE = Number(process.env.TARGET_EVIDENCE||10);
  const TARGET_SENT = Number(process.env.TARGET_SENT||8);

  const hashPct = ((kpi.hash_ratio||0)*100).toFixed(1) + '%';
  const ttdP50 = (kpi.ttd_p50_hours==null) ? '—' : `${Number(kpi.ttd_p50_hours).toFixed(1)}h`;
  const ttdP95 = (kpi.ttd_p95_hours==null) ? '—' : `${Number(kpi.ttd_p95_hours).toFixed(1)}h`;
  const ttdSamples = kpi.ttd_samples||0;

  const html =
`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daily Ops — ${date}</title>
<style>
body{font-family:ui-sans-serif,system-ui,Arial,sans-serif;margin:24px;color:#111827}
h1{font-size:24px;margin-bottom:12px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.kpi{padding:12px;border:1px solid #E5E7EB;border-radius:12px;background:#fff}
.kpi-head{font-weight:600;margin-bottom:8px}
.kpi-outer{height:10px;background:#e5e7eb;border-radius:999px;overflow:hidden}
.kpi-inner{height:10px;background:#2563eb}
.meta{margin-top:16px;font-size:14px;color:#374151}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#F3F4F6;border:1px solid #E5E7EB;margin-right:6px}
.pill.good{background:#ECFDF5;border-color:#10B981;color:#065F46}
.pill.warn{background:#FEF3C7;border-color:#F59E0B;color:#92400E}
.pill.bad{background:#FEE2E2;border-color:#EF4444;color:#991B1B}
.small{font-size:12px;color:#6B7280}
.section{margin-top:20px}
</style></head><body>
<h1>Daily Ops — ${date}</h1>

<div class="kpis">
  ${bar(kpi.evidence_today||0, TARGET_EVIDENCE, 'Evidence vs target (' + TARGET_EVIDENCE + ')')}
  ${bar(kpi.sent_today||0, TARGET_SENT, 'Sent vs target (' + TARGET_SENT + ')')}
  ${bar(Math.round((kpi.hash_ratio||0)*100), 100, 'Hash coverage %')}
</div>

<div class="section meta">
  ${pill('Hash '+hashPct, (kpi.hash_ratio>=0.4?'good':(kpi.hash_ratio>=0.2?'warn':'bad')))}
  ${pill('TTD P50 '+ttdP50)}
  ${pill('TTD P95 '+ttdP95)}
  ${pill('TTD samples '+ttdSamples)}
</div>

</body></html>`;

  const outDir = path.join(ROOT, 'reports', 'ops', date);
  fs.mkdirSync(outDir, {recursive:true});
  fs.writeFileSync(path.join(outDir,'index.html'), html, 'utf8');

  // Step summary
  const sum = [];
  sum.push('### Daily Ops');
  sum.push(`- date: **${date}**`);
  sum.push(`- evidence_today: **${kpi.evidence_today||0}** / target ${TARGET_EVIDENCE}`);
  sum.push(`- sent_today: **${kpi.sent_today||0}** / target ${TARGET_SENT}`);
  sum.push(`- hash_coverage: **${hashPct}**`);
  sum.push(`- TTD: P50 **${ttdP50}**, P95 **${ttdP95}**, samples **${ttdSamples}**`);
  if (process.env.GITHUB_STEP_SUMMARY){
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, sum.join('\n')+'\n', 'utf8');
  }
  console.log(sum.join('\n'));
}

main();
