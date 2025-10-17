#!/usr/bin/env node
/**
 * acceptance_check.js — final
 * 口径统一到 data/evidence.ndx（date-first），Burn-in( sent7<100 ) 降闸：
 * - 仅诊断 7d 投递，不因 sent_today<8 阻断；
 * - 若 72h 有变更，证据口径以 ndx 非零 hash；hash_coverage ≥ 40%；
 * - 抑制泄漏（unsub/bounce 仍在 leads.csv 为 new）为硬阻断。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVID_NDX = path.join(ROOT, 'data', 'evidence.ndx');
const OUT_LOG  = path.join(ROOT, 'data', 'outreach_log.csv');
const LEADS    = path.join(ROOT, 'data', 'leads.csv');
const UNSUB    = path.join(ROOT, 'data', 'unsubscribes.csv');
const BOUNCE   = path.join(ROOT, 'data', 'bounces.csv');
const COMPL    = path.join(ROOT, 'data', 'complaints.csv');

const TARGET_EVIDENCE = Number(process.env.TARGET_EVIDENCE || 10);
const TARGET_SENT     = Number(process.env.TARGET_SENT || 8);
const LOOKBACK_TTD_H  = Number(process.env.LOOKBACK_TTD_H || 72);

const todayUTC = () => new Date().toISOString().slice(0,10);
const isRealHash = h => !!(h && !/^0+$/i.test(String(h||'')));

function readLines(p){ try{ return fs.readFileSync(p,'utf8').split(/\r?\n/);}catch{ return []; } }

function ndxStats(){
  const lines = readLines(EVID_NDX);
  const today = todayUTC();
  let idxRows=0, hashOk=0, evidToday=0, baseToday=0;
  const changedVendors72h = new Set();
  const now = Date.now();
  const cutoff = now - LOOKBACK_TTD_H*3600*1000;

  for(const ln of lines){
    if(!ln || !ln.trim()) continue;
    idxRows++;
    const t = ln.split('\t'); // date, slug, type, hash, rel, url, run_url
    const when = (t[0]||'').slice(0,10);
    const ts = Date.parse(t[0]||'');
    const slug = t[1]||'';
    const hash = t[3]||'';

    if(isRealHash(hash)) hashOk++;
    if(when === today){
      if(isRealHash(hash)) evidToday++;
      else baseToday++;
    }
    if(Number.isFinite(ts) && ts>=cutoff && isRealHash(hash)){
      changedVendors72h.add(slug);
    }
  }
  return {idxRows, hashOk, evidToday, baseToday, changed72: changedVendors72h.size};
}

function sentStats(){
  const lines = readLines(OUT_LOG);
  const today = todayUTC();
  let sentToday=0, sent7=0;
  const now = Date.now(), cutoff = now - 7*24*3600*1000;
  for(const ln of lines){
    if(!ln || !ln.trim()) continue;
    const ts = (ln.split('\t')[0]||'').trim(); // ISO
    if(!ts) continue;
    const t = Date.parse(ts);
    if(!Number.isFinite(t)) continue;
    if(ts.startsWith(today)) sentToday++;
    if(t>=cutoff) sent7++;
  }
  return {sentToday, sent7};
}

function hashCoverage(){
  const lines = readLines(EVID_NDX);
  if(!lines.length) return 0;
  let ok=0, total=0;
  for(const ln of lines){
    if(!ln || !ln.trim()) continue;
    total++;
    const hash = (ln.split('\t')[3]||'');
    if(isRealHash(hash)) ok++;
  }
  return total? ok/total : 0;
}

function suppressionLeaks(){
  const leaks=[];
  const leads = readLines(LEADS).map(ln => ln.split(','));
  const emails = new Map();
  for(const c of leads){
    if(!c || !c.length) continue;
    const email=(c[0]||'').toLowerCase();
    const status=(c[7]||'').toLowerCase();
    emails.set(email, status);
  }
  const checkFile = (p, tag) => {
    for(const ln of readLines(p)){
      if(!ln || !ln.trim()) continue;
      const email = (ln.split(',')[0]||'').toLowerCase();
      if(!email) continue;
      const st = emails.get(email);
      if(st==='new' || !st){ leaks.push({email, tag}); }
    }
  };
  if(fs.existsSync(UNSUB))  checkFile(UNSUB,  'unsub');
  if(fs.existsSync(BOUNCE)) checkFile(BOUNCE, 'bounce');
  if(fs.existsSync(COMPL))  checkFile(COMPL,  'complaint');
  return leaks;
}

function main(){
  const ndx = ndxStats();
  const sent = sentStats();
  const cov  = hashCoverage();
  const leaks = suppressionLeaks();

  const summary = [];
  summary.push('Fullchain Check Summary');
  summary.push(`Date: ${todayUTC()}`);
  summary.push(`Evidence today: ${ndx.evidToday}`);
  summary.push(`Packs this month: (see /reports/)`);
  summary.push(`Changed vendors (72h): ${ndx.changed72}`);
  summary.push(`Sent today: ${sent.sentToday}`);
  summary.push(`Hash coverage: ${(cov*100).toFixed(1)}%`);
  summary.push(`TTD: P50 0.0h • P95 0.0h (samples=0, lookback=${LOOKBACK_TTD_H}h)`);

  const blocking = [];
  const warnings = [];

  // 抑制泄漏：硬阻断
  if(leaks.length>0){
    blocking.push(`抑制未生效：${leaks.length} 个邮箱仍为 status=new（含退订/退信/投诉）`);
  }

  // Burn-in 逻辑
  const burnIn = sent.sent7 < 100;

  // 证据与变更逻辑（只按 ndx 非零哈希）
  if(ndx.changed72 > 0){
    if(ndx.evidToday < TARGET_EVIDENCE){
      // 在 Burn-in 阶段，降为 WARN；过线后恢复阻断
      (burnIn ? warnings : blocking).push(`evidence_today ${ndx.evidToday} < ${TARGET_EVIDENCE}`);
    }
  } else {
    warnings.push('72h 无真实变更（changed_vendors_72h = 0）');
  }

  // 发送量逻辑
  if(sent.sentToday < TARGET_SENT){
    (burnIn ? warnings : blocking).push(`sent_today ${sent.sentToday} < ${TARGET_SENT}`);
  }

  // 覆盖率
  if(cov < 0.40){
    (burnIn ? warnings : blocking).push(`hash_ratio ${(cov*100).toFixed(1)}% < 40%`);
  }

  // 7d 投递：仅诊断
  summary.push(`deliverability(7d): sent7=${sent.sent7} (Burn-in=${burnIn}) — 仅诊断不过闸`);

  // 输出
  const out = [];
  out.push(summary.join('\n'));
  if(warnings.length) out.push('⚠️ WARN');
  for(const w of warnings) out.push(`- ${w}`);
  if(blocking.length) out.push('❌ FAIL');
  for(const b of blocking) out.push(`- ${b}`);

  console.log(out.join('\n'));

  // 写 Step Summary（若在 GH）
  if(process.env.GITHUB_STEP_SUMMARY){
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n')+'\n','utf8');
  }

  process.exit(blocking.length ? 1 : 0);
}

main();
