#!/usr/bin/env node
/**
 * Auto Acceptance Gate (final) — churn-aware
 * 规则：
 * - 若近72h「changed_vendors_72h > 0」=> 严格考核：Evidence今日、Sent今日、TTD、Deliverability。
 * - 若近72h无变更 => 不拦门（WARN），只保底检查：数据管道可用、异常不爆表。
 * - 7日投递比率：仅在 sent7 >= MIN_SENT7_FOR_DLVR 时严格考核；否则只 WARN（burn-in）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'artifacts', 'daily_ops.json');
const EVID_DIR = path.join(ROOT, 'evidence');
const OUTREACH = path.join(ROOT, 'data', 'outreach_log.csv');
const EVID_NDX = path.join(ROOT, 'data', 'evidence.ndx');

const envNum = (k, d)=> Number(process.env[k] ?? d);
const TARGET_SENT          = envNum('TARGET_SENT', 8);
const TARGET_EVID_TODAY    = envNum('TARGET_EVID_TODAY', 10);
const MIN_HASH_RATIO       = envNum('MIN_HASH_RATIO', 0.4);
const REQUIRE_CHANGED_VEND = envNum('REQUIRE_CHANGED_VENDORS', 1);

const P95_TTD_MAX_HOURS    = envNum('P95_TTD_MAX_HOURS', 24);
const MIN_TTD_SAMPLES      = envNum('MIN_TTD_SAMPLES', 10);
const TTD_LOOKBACK_HOURS   = envNum('TTD_LOOKBACK_HOURS', 72);

const MIN_SENT7_FOR_DLVR   = envNum('MIN_SENT7_FOR_DLVR', 100);
const UNSUB_7D_MAX         = envNum('UNSUB_7D_MAX', 0.005);
const COMPLAINT_7D_MAX     = envNum('COMPLAINT_7D_MAX', 0.001);
const BOUNCE_7D_MAX        = envNum('BOUNCE_7D_MAX', 0.08);

const stepSummary = process.env.GITHUB_STEP_SUMMARY;

function todayUTC(){
  const d = new Date();
  return d.toISOString().slice(0,10); // YYYY-MM-DD
}
function readJSON(fp){ try{ return JSON.parse(fs.readFileSync(fp,'utf8')); }catch{ return null; } }
function readLines(fp){ if(!fs.existsSync(fp)) return []; return fs.readFileSync(fp,'utf8').split(/\r?\n/); }
function isNonZeroHash(h){ return !!h && !/^0+$/.test(h); }

function computeEvidenceTodayNonZero(){
  // 快速从文件名统计当日非零hash证据
  const today = todayUTC();
  if (!fs.existsSync(EVID_DIR)) return 0;
  let n = 0;
  for (const vendor of fs.readdirSync(EVID_DIR, { withFileTypes:true }).filter(d=>d.isDirectory()).map(d=>d.name)){
    const dir = path.join(EVID_DIR, vendor);
    for (const f of fs.readdirSync(dir)){
      if (!f.endsWith('.json')) continue;
      if (!f.startsWith(today+'-')) continue;
      if (f.includes('00000000')) continue;
      n++;
    }
  }
  return n;
}

function computeChangedVendors72h(){
  // 若 artifacts 无该指标，则从 evidence.ndx 估算
  if (fs.existsSync(ART)) {
    const a = readJSON(ART);
    if (a && a.kpi && typeof a.kpi.changed_vendors_72h === 'number') return a.kpi.changed_vendors_72h;
  }
  const lines = readLines(EVID_NDX);
  const cutoff = Date.now() - TTD_LOOKBACK_HOURS*3600*1000;
  const set = new Set();
  for (const ln of lines){
    if (!ln.trim()) continue;
    const [when, domain,, hash] = ln.split('\t');
    const t = Date.parse(when||'');
    if (!isNaN(t) && t >= cutoff && isNonZeroHash(hash||'')) set.add(domain);
  }
  return set.size;
}

function computeSentToday(){
  if (!fs.existsSync(OUTREACH)) return 0;
  const lines = readLines(OUTREACH);
  const header = lines[0] && /when|status/i.test(lines[0]) ? lines[0].split(',').map(s=>s.toLowerCase()) : [];
  const iWhen = header.length ? Math.max(0, header.findIndex(h=>h.includes('when'))) : 0;
  const iStat = header.length ? header.findIndex(h=>h.includes('status')) : 8;
  const today = todayUTC();
  let n=0;
  for (let i=header.length?1:0; i<lines.length; i++){
    const cols = lines[i].split(',');
    const when = (cols[iWhen]||'').slice(0,10);
    const st = (cols[iStat]||'').toLowerCase();
    if (when===today && st==='sent') n++;
  }
  return n;
}

function computeSent7_Unsub7_Bounce7_Complaint7(){
  const cutoff = Date.now() - 7*24*3600*1000;
  let sent7 = 0;
  const lastSentAt = new Map();
  if (fs.existsSync(OUTREACH)){
    const lines = readLines(OUTREACH);
    const header = lines[0] && /when|email|status/i.test(lines[0]) ? lines[0].split(',').map(s=>s.toLowerCase()) : [];
    const iWhen = header.length ? Math.max(0, header.findIndex(h=>h.includes('when'))) : 0;
    const iEmail= header.length ? Math.max(0, header.findIndex(h=>h.includes('email'))) : 1;
    const iStat = header.length ? header.findIndex(h=>h.includes('status')) : 8;
    for (let i=header.length?1:0; i<lines.length; i++){
      const c = lines[i].split(',');
      const t = Date.parse(c[iWhen]||'');
      const em = (c[iEmail]||'').toLowerCase();
      const st = (c[iStat]||'').toLowerCase();
      if (!em || isNaN(t)) continue;
      if (st==='sent'){
        if (t>=cutoff) sent7++;
        const prev = lastSentAt.get(em);
        if (!prev || t>prev) lastSentAt.set(em, t);
      }
    }
  }
  function countValid(fp){
    if (!fs.existsSync(fp)) return 0;
    const lines = readLines(fp);
    const header = lines[0] && /when|email/i.test(lines[0]) ? lines[0].split(',').map(s=>s.toLowerCase()) : [];
    const iWhen = header.length ? Math.max(0, header.findIndex(h=>h.includes('when'))) : -1;
    const iEmail= header.length ? Math.max(0, header.findIndex(h=>h.includes('email'))) : 0;
    let n=0;
    for (let i=header.length?1:0; i<lines.length; i++){
      const c = lines[i].split(',');
      const em = (c[iEmail]||'').toLowerCase();
      const t  = iWhen>=0 ? Date.parse(c[iWhen]||'') : NaN;
      if (!em) continue;
      if (isNaN(t)) continue; // 没时间戳不计入7日
      if (t < cutoff) continue;
      const ls = lastSentAt.get(em)||-Infinity;
      if (t >= ls) n++;
    }
    return n;
  }
  const unsub7 = countValid(path.join(ROOT,'data','unsubscribes.csv'));
  const bounce7 = countValid(path.join(ROOT,'data','bounces.csv'));
  const complaint7 = countValid(path.join(ROOT,'data','complaints.csv'));
  return { sent7, unsub7, bounce7, complaint7 };
}

function main(){
  const art = readJSON(ART);
  const kpi = art && art.kpi ? art.kpi : {};
  const evidenceTodayNonZero = computeEvidenceTodayNonZero();
  const sentToday = computeSentToday();
  const hashRatio = typeof kpi.hash_ratio === 'number' ? kpi.hash_ratio : 0;

  const changedVendors72h = computeChangedVendors72h();
  const hasChurn = changedVendors72h > 0 || !REQUIRE_CHANGED_VEND;

  // 7d投递
  const { sent7, unsub7, bounce7, complaint7 } = computeSent7_Unsub7_Bounce7_Complaint7();
  const unsubRate = sent7>0 ? unsub7/sent7 : 0;
  const bounceRate = sent7>0 ? bounce7/sent7 : 0;
  const complaintRate = sent7>0 ? complaint7/sent7 : 0;

  // TTD
  const ttdSamples = Number(kpi.ttd_samples||0);
  const ttdP95 = Number(kpi.ttd_p95_hours||0);

  const FAIL = [];
  const WARN = [];

  // —— 核心：是否有“变更机会” ——
  if (!hasChurn){
    WARN.push(`近${TTD_LOOKBACK_HOURS}h 未检测到真实变更（changed_vendors_72h=${changedVendors72h}），当日 Evidence/Sent 不作为拦截条件。`);
  } else {
    if (evidenceTodayNonZero < TARGET_EVID_TODAY){
      FAIL.push(`evidence_today ${evidenceTodayNonZero} < ${TARGET_EVID_TODAY}`);
    }
    if (sentToday < TARGET_SENT){
      FAIL.push(`sent_today ${sentToday} < ${TARGET_SENT}`);
    }
  }

  // 哈希覆盖率（无论是否有变更都应健康）
  if (hashRatio < MIN_HASH_RATIO){
    WARN.push(`hash_ratio ${(hashRatio*100).toFixed(1)}% < ${(MIN_HASH_RATIO*100).toFixed(0)}%`);
  }

  // TTD（只在有样本时考核；样本不足时 WARN）
  if (ttdSamples >= MIN_TTD_SAMPLES){
    if (ttdP95 > P95_TTD_MAX_HOURS){
      FAIL.push(`P95 TTD ${ttdP95}h > ${P95_TTD_MAX_HOURS}h`);
    }
  } else {
    WARN.push(`TTD 样本不足（${ttdSamples} < ${MIN_TTD_SAMPLES}）`);
  }

  // 7日投递（burn-in）
  if (sent7 >= MIN_SENT7_FOR_DLVR){
    if (unsubRate > UNSUB_7D_MAX) FAIL.push(`unsub_7d ${(unsubRate*100).toFixed(2)}% > ${(UNSUB_7D_MAX*100)}%`);
    if (bounceRate > BOUNCE_7D_MAX) FAIL.push(`bounce_7d ${(bounceRate*100).toFixed(2)}% > ${(BOUNCE_7D_MAX*100)}%`);
    if (complaintRate > COMPLAINT_7D_MAX) FAIL.push(`complaint_7d ${(complaintRate*100).toFixed(2)}% > ${(COMPLAINT_7D_MAX*100)}%`);
  } else {
    WARN.push(`Burn-in：sent7=${sent7} < ${MIN_SENT7_FOR_DLVR}，7日投递只做诊断不过闸`);
  }

  // 输出
  const summary = [];
  summary.push(`### Acceptance`);
  summary.push(`- evidence_today (non-zero): **${evidenceTodayNonZero}** / target ${TARGET_EVID_TODAY}`);
  summary.push(`- sent_today: **${sentToday}** / target ${TARGET_SENT}`);
  summary.push(`- changed_vendors_72h: **${changedVendors72h}** (hasChurn=${hasChurn})`);
  summary.push(`- hash_ratio: **${(hashRatio*100).toFixed(1)}%** (min ${(MIN_HASH_RATIO*100)}%)`);
  summary.push(`- TTD: P95 **${ttdP95}h** (max ${P95_TTD_MAX_HOURS}h), samples **${ttdSamples}** (min ${MIN_TTD_SAMPLES})`);
  summary.push(`- deliverability(7d): sent7=${sent7}, unsub=${unsub7}(${(unsubRate*100).toFixed(2)}%), bounce=${bounce7}(${(bounceRate*100).toFixed(2)}%), complaint=${complaint7}(${(complaintRate*100).toFixed(2)}%)`);
  if (WARN.length) summary.push(`Warnings:\n- ${WARN.join('\n- ')}`);
  if (FAIL.length) summary.push(`Blocking reasons:\n- ${FAIL.join('\n- ')}`);

  console.log(summary.join('\n'));
  if (stepSummary) fs.appendFileSync(stepSummary, summary.join('\n')+'\n', 'utf8');

  if (FAIL.length){
    // 若是 TTD fail，则在 Summary 打标，供后续工作流分支（自动补采样）识别
    if (FAIL.some(s=>/TTD/i.test(s))) {
      if (stepSummary) fs.appendFileSync(stepSummary, '\nreason=ttd_fail\n', 'utf8');
    }
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
