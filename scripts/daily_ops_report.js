#!/usr/bin/env node
/**
 * Daily Ops Report（final, fixed）
 * - 优先读取 artifacts/daily_ops.json（如无则兜底计算）
 * - 生成 /reports/ops/<YYYY-MM-DD>/index.html
 * - sent_today：优先 data/sent_log.csv（真实发送），否则回退 outreach_log.csv 中 status=sent
 * - hash_ratio：当天有 hash!=0 的证据 / 当天证据总数（UTC）
 * - 无嵌套反引号；CSS 值合法
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'artifacts', 'daily_ops.json');
const EVID_NDX = path.join(ROOT, 'data', 'evidence.ndx');
const OUTREACH = path.join(ROOT, 'data', 'outreach_log.csv');
const SENTLOG  = path.join(ROOT, 'data', 'sent_log.csv');

function readJSON(p){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{return null;} }
function readLines(p){ try{ return fs.readFileSync(p,'utf8').split(/\r?\n/);}catch{return []; } }
function todayStrUTC(){ return new Date().toISOString().slice(0,10); }
function isRealHash(h){ return !!(h && !/^0+$/i.test(String(h))); }
function isISODatePrefix(line){ return /^\d{4}-\d{2}-\d{2}T/.test(line); }

function fallbackKPI(){
  const today = todayStrUTC();

  // --- evidence_today / hash_ratio（只算今天）
  let evidence_today = 0;
  let hash_ok_today = 0;
  if (fs.existsSync(EVID_NDX)){
    for (const ln of readLines(EVID_NDX)){
      if(!ln) continue;
      const parts = ln.split('\t'); // date, vendor, type, hash, ...
      const when = (parts[0]||'').slice(0,10);
      const hash = parts[3] || '';
      if (when === today){
        evidence_today++;
        if (isRealHash(hash)) hash_ok_today++;
      }
    }
  }
  const hash_ratio = evidence_today > 0 ? (hash_ok_today / evidence_today) : 0;

  // --- sent_today（优先 sent_log，其次 outreach: status=sent）
  let sent_today = 0;
  const todayPrefix = today + 'T';
  let sent_source = 'none';

  if (fs.existsSync(SENTLOG)){
    for (const ln of readLines(SENTLOG)){
      if (!ln || !isISODatePrefix(ln)) continue; // 跳过表头/空行
      if (ln.startsWith(todayPrefix)) sent_today++;
    }
    sent_source = 'sent_log.csv';
  } else if (fs.existsSync(OUTREACH)){
    for (const ln of readLines(OUTREACH)){
      if (!ln || !isISODatePrefix(ln)) continue;
      if (!ln.startsWith(todayPrefix)) continue;
      // 仅统计 status=sent（避免把 DRY 计入）
      const cols = ln.split(',');
      const last = (cols[cols.length-1]||'').trim().toLowerCase();
      if (last === 'sent') sent_today++;
    }
    sent_source = 'outreach_log.csv(status=sent)';
  }

  return {
    kpi:{ evidence_today, sent_today, hash_ratio, ttd_p50_hours:null, ttd_p95_hours:null, ttd_samples:0 },
    date: today,
    _source: { kpi: 'fallback', sent: sent_source }
  };
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
  const fromArt = readJSON(ART);
  const fallback = fallbackKPI();

  // 选择数据来源：优先 artifacts，但允许显示来源
  const data = fromArt && fromArt.kpi ? fromArt : fallback;
  const kpi = data.kpi || {};
  const date = data.date || todayStrUTC();

  const TARGET_EVIDENCE = Number(process.env.TARGET_EVIDENCE||10);
  const TARGET_SENT = Number(process.env.TARGET_SENT||8);

  const hashPct = ((kpi.hash_ratio||0)*100).toFixed(1) + '%';
  const ttdP50 = (kpi.ttd_p50_hours==null) ? '—' : `${Number(kpi.ttd_p50_hours).toFixed(1)}h`;
  const ttdP95 = (kpi.ttd_p95_hours==null) ? '—' : `${Number(kpi.ttd_p95_hours).toFixed(1)}h`;
  const ttdSamples = kpi.ttd_samples||0;

  const html =
'<!doctype html>\n' +
'<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>Daily Ops — ' + date + '</title>\n' +
'<style>\n' +
'body{font-family:ui-sans-serif,system-ui,Arial,sans-serif;margin:24px;color:#111827}\n' +
'h1{font-size:24px;margin-bottom:12px}\n' +
'.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}\n' +
'.kpi{padding:12px;border:1px solid #E5E7EB;border-radius:12px;background:#fff}\n' +
'.kpi-head{font-weight:600;margin-bottom:8px}\n' +
'.kpi-outer{height:10px;background:#e5e7eb;border-radius:999px;overflow:hidden}\n' +
'.kpi-inner{height:10px;background:#2563eb}\n' +
'.meta{margin-top:16px;font-size:14px;color:#374151}\n' +
'.pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#F3F4F6;border:1px solid #E5E7EB;margin-right:6px}\n' +
'.pill.good{background:#ECFDF5;border-color:#10B981;color:#065F46}\n' +
'.pill.warn{background:#FEF3C7;border-color:#F59E0B;color:#92400E}\n' +
'.pill.bad{background:#FEE2E2;border-color:#EF4444;color:#991B1B}\n' +
'.small{font-size:12px;color:#6B7280}\n' +
'.section{margin-top:20px}\n' +
'</style></head><body>\n' +
'<h1>Daily Ops — ' + date + '</h1>\n' +
'\n' +
'<div class="kpis">\n' +
'  ' + bar(kpi.evidence_today||0, TARGET_EVIDENCE, 'Evidence vs target (' + TARGET_EVIDENCE + ')') + '\n' +
'  ' + bar(kpi.sent_today||0, TARGET_SENT, 'Sent vs target (' + TARGET_SENT + ')') + '\n' +
'  ' + bar(Math.round((kpi.hash_ratio||0)*100), 100, 'Hash coverage %') + '\n' +
'</div>\n' +
'\n' +
'<div class="section meta">\n' +
'  ' + pill('Hash ' + hashPct, (kpi.hash_ratio>=0.4?'good':(kpi.hash_ratio>=0.2?'warn':'bad'))) + '\n' +
'  ' + pill('TTD P50 ' + ttdP50) + '\n' +
'  ' + pill('TTD P95 ' + ttdP95) + '\n' +
'  ' + pill('TTD samples ' + ttdSamples) + '\n' +
'</div>\n' +
'\n' +
'</body></html>';

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
  // 标注数据来源，便于诊断
  const sourceNote = fromArt && fromArt.kpi
    ? '- source: **artifacts/daily_ops.json**'
    : `- source: **fallback** (sent from ${fallback._source.sent||'none'})`;
  sum.push(sourceNote);

  if (process.env.GITHUB_STEP_SUMMARY){
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, sum.join('\n')+'\n', 'utf8');
  }
  console.log(sum.join('\n'));
}

main();
