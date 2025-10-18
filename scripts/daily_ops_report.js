#!/usr/bin/env node
/**
 * Daily Ops Report（覆盖版）
 * - 优先读取 artifacts/daily_ops.json（含 PASS/WARN/FAIL/kpi 等）
 * - 若缺失则兜底计算（evidence_today/hash_ratio/sent_today）
 * - 产出 /reports/ops/<YYYY-MM-DD>/index.html（含 noindex）与 index.json
 * - sent_today：优先 data/sent_log.csv（真实发送），否则回退 outreach_log.csv 中 status=sent
 * - hash_ratio：当天 hash!=0 证据 / 当天证据总数（UTC）
 * - 展示 PASS/WARN/FAIL（如有），并对 TTD 样本不足打标
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const ART_PATH  = path.join(ROOT, 'artifacts', 'daily_ops.json');
const EVID_NDX  = path.join(ROOT, 'data', 'evidence.ndx');
const OUTREACH  = path.join(ROOT, 'data', 'outreach_log.csv');
const SENTLOG   = path.join(ROOT, 'data', 'sent_log.csv');

// 目标（可用环境变量覆盖）
const TARGET_EVIDENCE = Number(process.env.TARGET_EVIDENCE || 30);
const TARGET_SENT     = Number(process.env.TARGET_SENT     || 40);

// ---------- utils ----------
function readJSON(p){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{return null;} }
function readLines(p){ try{ return fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/);}catch{return []; } }
function todayStrUTC(){ return new Date().toISOString().slice(0,10); }
function isISODatePrefix(s){ return /^\d{4}-\d{2}-\d{2}T/.test(s||''); }
function isRealHash(h){ const s = String(h||'').trim(); return !!s && !/^0+$/i.test(s); }
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function pct(x){ return Math.round(clamp01(x)*100); }
function pill(txt, tone){ return `<span class="pill ${tone||''}">${txt}</span>`; }
function ensureDir(p){ fs.mkdirSync(p, { recursive:true }); }

// ---------- fallback 计算 ----------
function fallbackKPI(){
  const today = todayStrUTC();
  let evidence_today = 0;
  let hash_ok_today  = 0;

  if (fs.existsSync(EVID_NDX)){
    for (const ln of readLines(EVID_NDX)){
      if (!ln) continue;
      const parts = ln.split('\t'); // 约定: date\tvendor\ttype\thash\t...
      const when = (parts[0]||'').slice(0,10);
      const hash = parts[3] || '';
      if (when === today){
        evidence_today++;
        if (isRealHash(hash)) hash_ok_today++;
      }
    }
  }
  const hash_ratio = evidence_today ? (hash_ok_today / evidence_today) : 0;

  // sent_today：优先 sent_log.csv（真实发送），否则 outreach_log.csv(status=sent)
  const todayPrefix = today + 'T';
  let sent_today = 0;
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
      // 仅计入 status=sent（避免把 dry 计入）
      // 允许 CSV 中有逗号，用「末列」判断较稳妥
      const cols = ln.split(',');
      const last = (cols[cols.length-1]||'').trim().toLowerCase();
      if (last === 'sent') sent_today++;
    }
    sent_source = 'outreach_log.csv(status=sent)';
  }

  return {
    date: today,
    YM: today.slice(0,7),
    kpi: {
      evidence_today,
      sent_today,
      hash_ratio,
      ttd_p50_hours: null,
      ttd_p95_hours: null,
      ttd_samples: 0
    },
    PASS: [],
    WARN: [],
    FAIL: [],
    _source: { kpi: 'fallback', sent: sent_source }
  };
}

// ---------- 视图 ----------
function bar(cur, target, label){
  const pctNum = target > 0 ? Math.round(100 * (Number(cur||0) / target)) : 0;
  const width = Math.max(0, Math.min(100, pctNum));
  return [
    '<div class="kpi">',
      '<div class="kpi-head">', label, '</div>',
      '<div class="kpi-outer"><div class="kpi-inner" style="width:', width, '%;"></div></div>',
      '<div class="small">', Number(cur||0), ' / ', target, ' (', width, '%)</div>',
    '</div>'
  ].join('');
}

function buildHTML(model){
  const date = model.date;
  const kpi  = model.kpi || {};
  const hashPctText = (clamp01(kpi.hash_ratio||0)*100).toFixed(1) + '%';
  const ttdP50 = (kpi.ttd_p50_hours==null) ? '—' : `${Number(kpi.ttd_p50_hours).toFixed(1)}h`;
  const ttdP95 = (kpi.ttd_p95_hours==null) ? '—' : `${Number(kpi.ttd_p95_hours).toFixed(1)}h`;
  const ttdN   = Number(kpi.ttd_samples||0);

  // 状态条（来自 artifacts；若无则根据阈值做简单打标）
  const pills = [];
  const hashTone = (kpi.hash_ratio>=0.4?'good':(kpi.hash_ratio>=0.2?'warn':'bad'));
  pills.push(pill('Hash ' + hashPctText, hashTone));
  pills.push(pill('TTD P50 ' + ttdP50));
  pills.push(pill('TTD P95 ' + ttdP95));
  pills.push(pill('TTD samples ' + ttdN));

  // 如果 artifacts 带有 PASS/WARN/FAIL，则渲染
  const statusBlocks = [];
  if (Array.isArray(model.PASS) && model.PASS.length){
    statusBlocks.push('<div class="status-row"><div class="label pass">PASS</div><div class="items">'+model.PASS.map(x=>pill(x,'good')).join(' ')+'</div></div>');
  }
  if (Array.isArray(model.WARN) && model.WARN.length){
    statusBlocks.push('<div class="status-row"><div class="label warn">WARN</div><div class="items">'+model.WARN.map(x=>pill(x,'warn')).join(' ')+'</div></div>');
  }
  if (Array.isArray(model.FAIL) && model.FAIL.length){
    statusBlocks.push('<div class="status-row"><div class="label fail">FAIL</div><div class="items">'+model.FAIL.map(x=>pill(x,'bad')).join(' ')+'</div></div>');
  }

  const changedVendors = model?.kpi?.changed_vendors_72h ?? model?.changed_vendors_72h;

  const html =
'<!doctype html>\n' +
'<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<meta name="robots" content="noindex,nofollow">\n' +
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
'.pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#F3F4F6;border:1px solid #E5E7EB;margin-right:6px;margin-bottom:6px}\n' +
'.pill.good{background:#ECFDF5;border-color:#10B981;color:#065F46}\n' +
'.pill.warn{background:#FEF3C7;border-color:#F59E0B;color:#92400E}\n' +
'.pill.bad{background:#FEE2E2;border-color:#EF4444;color:#991B1B}\n' +
'.small{font-size:12px;color:#6B7280}\n' +
'.section{margin-top:20px}\n' +
'.status{margin-top:12px;border:1px dashed #E5E7EB;border-radius:12px;padding:10px}\n' +
'.status-row{display:flex;gap:10px;align-items:center;margin:6px 0}\n' +
'.status .label{font-weight:700;font-size:12px;padding:2px 8px;border-radius:999px}\n' +
'.status .label.pass{background:#ECFDF5;color:#065F46}\n' +
'.status .label.warn{background:#FEF3C7;color:#92400E}\n' +
'.status .label.fail{background:#FEE2E2;color:#991B1B}\n' +
'</style></head><body>\n' +
'<h1>Daily Ops — ' + date + '</h1>\n' +
'\n' +
'<div class="kpis">\n' +
'  ' + bar(kpi.evidence_today||0, TARGET_EVIDENCE, 'Evidence vs target (' + TARGET_EVIDENCE + ')') + '\n' +
'  ' + bar(kpi.sent_today||0,     TARGET_SENT,     'Sent vs target (' + TARGET_SENT + ')') + '\n' +
'  ' + bar(Math.round((kpi.hash_ratio||0)*100), 100, 'Hash coverage %') + '\n' +
'</div>\n' +
'\n' +
'<div class="section meta">\n' +
'  ' + pills.join(' ') + '\n' +
( (typeof changedVendors === 'number') ? ('  '+pill('Changed vendors (72h) '+changedVendors, changedVendors>0?'good':'warn')+'\n') : '' ) +
'</div>\n' +
( statusBlocks.length ? ('<div class="section status">' + statusBlocks.join('') + '</div>\n') : '' ) +
'\n' +
'</body></html>';

  return html;
}

// ---------- 主流程 ----------
function main(){
  const art = readJSON(ART_PATH);
  const fb  = fallbackKPI();
  const model = (art && art.kpi) ? art : fb;      // 优先 artifacts
  model.date = model.date || todayStrUTC();

  // 若 TTD 样本不足而 artifacts 未打标，补一条 WARN（不改变 artifacts 文件，仅用于展示）
  if ((model?.kpi?.ttd_samples||0) > 0 && (model?.kpi?.ttd_samples||0) < Number(process.env.MIN_TTD_SAMPLES || 10)) {
    model.WARN = Array.isArray(model.WARN) ? model.WARN.slice() : [];
    if (!model.WARN.some(s => /TTD\s*样本/i.test(String(s)))) {
      model.WARN.push('TTD 样本不足（近窗口样本量不足）');
    }
  }

  // 输出 HTML 与 JSON
  const outDir = path.join(ROOT, 'reports', 'ops', model.date);
  ensureDir(outDir);
  const html = buildHTML(model);
  fs.writeFileSync(path.join(outDir,'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(outDir,'index.json'), JSON.stringify(model, null, 2), 'utf8');

  // Step summary（供 GitHub Summary）
  const k = model.kpi || {};
  const sum = [];
  sum.push('### Daily Ops');
  sum.push(`- date: **${model.date}**`);
  sum.push(`- evidence_today: **${k.evidence_today||0}** / target ${TARGET_EVIDENCE}`);
  sum.push(`- sent_today: **${k.sent_today||0}** / target ${TARGET_SENT}`);
  sum.push(`- hash_coverage: **${(clamp01(k.hash_ratio||0)*100).toFixed(1)}%**`);
  sum.push(`- TTD: P50 **${k.ttd_p50_hours==null?'—':Number(k.ttd_p50_hours).toFixed(1)+'h'}**, P95 **${k.ttd_p95_hours==null?'—':Number(k.ttd_p95_hours).toFixed(1)+'h'}**, samples **${k.ttd_samples||0}**`);
  const sourceNote = (art && art.kpi)
    ? '- source: **artifacts/daily_ops.json**'
    : `- source: **fallback** (sent from ${fb._source?.sent||'none'})`;
  sum.push(sourceNote);

  if (process.env.GITHUB_STEP_SUMMARY){
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, sum.join('\n')+'\n', 'utf8');
  }
  console.log(sum.join('\n'));
}

main();
