#!/usr/bin/env node
/**
 * Auto Acceptance Gate（覆盖版 · 含 TTD & 7 天健康阈值）
 *
 * 用法：在 Auto Acceptance 工作流中，先运行 fullchain_check.js 产出 artifacts/daily_ops.json，
 * 再运行本脚本。本脚本会把结论写到 GITHUB_STEP_SUMMARY，并用退出码控制通过/失败。
 *
 * 判定逻辑（任一命中即 FAIL）：
 *  A) fullchain_check 的 FAIL 列表非空（链接错误 / 抑制未生效 / 回写失败等）
 *  B) 硬阈值未达：evidence_today / sent_today / hash_ratio / changed_vendors_72h
 *  C) 近 7 天健康阈值：退订/投诉/退信比例超出上限（分母=近 7 天 sent）
 *  D) TTD（Time-to-Detect）硬阈值：近 TTD_LOOKBACK_HOURS 的 P95 TTD > 上限
 *
 * 环境变量（可不设使用默认值）：
 *  TARGET_SENT=8
 *  TARGET_EVID_TODAY=10
 *  MIN_HASH_RATIO=0.4                // 40%
 *  REQUIRE_CHANGED_VENDORS=1         // 是否要求 72h 内必须有变化的厂商
 *  UNSUB_7D_MAX=0.005                // 0.5%
 *  COMPLAINT_7D_MAX=0.001            // 0.1%
 *  BOUNCE_7D_MAX=0.08                // 8%（红线）
 *  P95_TTD_MAX_HOURS=24              // P95 TTD 硬阈值（小时）
 *  MIN_TTD_SAMPLES=10                // TTD 样本不足时仅 WARN 不阻断
 *  TTD_LOOKBACK_HOURS=72             // 统计窗口
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'artifacts', 'daily_ops.json');
const D   = (p) => path.join(ROOT, 'data', p);

const cfg = {
  TARGET_SENT: Number(process.env.TARGET_SENT || 8),
  TARGET_EVID_TODAY: Number(process.env.TARGET_EVID_TODAY || 10),
  MIN_HASH_RATIO: Number(process.env.MIN_HASH_RATIO || 0.4),
  REQUIRE_CHANGED_VENDORS: Number(process.env.REQUIRE_CHANGED_VENDORS || 1),
  // 7d 健康阈值
  UNSUB_7D_MAX: Number(process.env.UNSUB_7D_MAX || 0.005),
  COMPLAINT_7D_MAX: Number(process.env.COMPLAINT_7D_MAX || 0.001),
  BOUNCE_7D_MAX: Number(process.env.BOUNCE_7D_MAX || 0.08),
  // TTD
  P95_TTD_MAX_HOURS: Number(process.env.P95_TTD_MAX_HOURS || 24),
  MIN_TTD_SAMPLES: Number(process.env.MIN_TTD_SAMPLES || 10),
  TTD_LOOKBACK_HOURS: Number(process.env.TTD_LOOKBACK_HOURS || 72),
};

function readText(fp){ try { return fs.readFileSync(fp,'utf8'); } catch { return ''; } }
function readJSON(fp){ try { return JSON.parse(readText(fp)); } catch { return null; } }
function exists(fp){ try { return fs.existsSync(fp); } catch { return false; } }
function summaryAdd(md){ if(process.env.GITHUB_STEP_SUMMARY){ fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } }
function setOutput(k,v){ if(process.env.GITHUB_OUTPUT){ fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); } }

function parseCSV(fp){
  const txt = readText(fp);
  if (!txt) return { header: null, rows: [] };
  const lines = txt.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { header: null, rows: [] };
  const first = lines[0].split(',');
  const hasHeader = first.some(x => /^(when|date|timestamp|email|status)$/i.test(x.trim()));
  const header = hasHeader ? first.map(s=>s.trim()) : null;
  const start = hasHeader ? 1 : 0;
  const rows = lines.slice(start).map(l => l.split(','));
  return { header, rows };
}
function findCol(header, candidates){
  if (!header) return -1;
  const idx = header.findIndex(h => candidates.some(c => h.toLowerCase() === c));
  return idx;
}
function parseWhen(val){
  if (!val) return NaN;
  const s = String(val).trim();
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  const m = s.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?/);
  if (m) {
    const t2 = Date.parse(m[0]);
    if (!Number.isNaN(t2)) return t2;
  }
  return NaN;
}
function withinHours(ts, hours){
  if (Number.isNaN(ts)) return false;
  const cutoff = Date.now() - hours*3600*1000;
  return ts >= cutoff;
}
function withinDays(ts, days){ return withinHours(ts, days*24); }

function metric7d() {
  // 分母：近 7 天 sent 数（来自 outreach_log.csv）
  const out = parseCSV(D('outreach_log.csv'));
  let cWhen = -1, cStatus = -1;
  if (out.header){
    cWhen = findCol(out.header, ['when','date','timestamp']);
    cStatus = findCol(out.header, ['status']);
  }
  let sent7 = 0;
  for (const r of out.rows){
    const st = cStatus >= 0 ? (r[cStatus]||'').trim().toLowerCase() : (r[r.length-1]||'').trim().toLowerCase();
    const ts = cWhen >= 0 ? parseWhen(r[cWhen]) : parseWhen(r.find(parseWhen));
    if (st === 'sent' && withinDays(ts,7)) sent7++;
  }
  // 分子：unsub / complaints / bounces（没有或无时间戳则不计入 7d）
  function count7d(fp, colWhenGuess=0){
    const t = parseCSV(fp);
    if (!t.rows.length) return 0;
    let cW = -1;
    if (t.header) cW = findCol(t.header, ['when','date','timestamp']);
    return t.rows.reduce((acc, row) => {
      let ts = NaN;
      if (cW >= 0) ts = parseWhen(row[cW]);
      else ts = parseWhen(row[colWhenGuess]) || parseWhen(row.find(parseWhen));
      return acc + (withinDays(ts,7) ? 1 : 0);
    }, 0);
  }
  const unsub7  = exists(D('unsubscribes.csv')) ? count7d(D('unsubscribes.csv')) : 0;
  const comp7   = exists(D('complaints.csv'))   ? count7d(D('complaints.csv'))   : 0;
  const bounce7 = exists(D('bounces.csv'))      ? count7d(D('bounces.csv'))      : 0;
  const pct = (x) => (sent7>0 ? x/sent7 : 0);
  return { sent7, unsub7, comp7, bounce7,
           unsubRate: pct(unsub7), compRate: pct(comp7), bounceRate: pct(bounce7) };
}

// —— TTD 计算 ——
// evidence.ndx 假定为 TSV：date \t vendor \t endpoint \t hash \t type? ...
// 仅统计“真实变更”（hash 存在且非 0 串），按同一 (vendor, endpoint) 相邻记录的时间间隔作为 TTD 样本
function readEvidence() {
  const txt = readText(D('evidence.ndx'));
  if (!txt) return [];
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const l of lines) {
    const cols = l.split('\t');
    const date = cols[0] || '';
    const ts = Date.parse(date + (date.length===10 ? 'T00:00:00Z' : ''));
    const vendor = cols[1] || '';
    const endpoint = cols[2] || '';
    const hash = cols[3] || '';
    rows.push({ ts, date, vendor, endpoint, hash });
  }
  return rows.filter(r => !Number.isNaN(r.ts));
}
function isRealHash(h){ return !!h && !/^0+$/i.test(String(h)); }
function percentile(sortedAsc, p){
  if (!sortedAsc.length) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const w = idx - lo;
  return sortedAsc[lo]*(1-w) + sortedAsc[hi]*w;
}
function computeTTDFromNDX(lookbackHours){
  const rows = readEvidence();
  if (!rows.length) return { p50:0, p95:0, n:0 };
  // 仅用“当前样本点在窗口内”的相邻差分
  const key = (r) => `${r.vendor}|${r.endpoint}`;
  const byKey = new Map();
  rows.sort((a,b)=>a.ts-b.ts);
  for (const r of rows){
    if (!isRealHash(r.hash)) continue; // 只算真实变更
    const k = key(r);
    const list = byKey.get(k) || [];
    list.push(r);
    byKey.set(k, list);
  }
  const cutoff = Date.now() - lookbackHours*3600*1000;
  const samplesH = [];
  for (const list of byKey.values()){
    // 相邻两次抓取间隔（小时）
    for (let i=1;i<list.length;i++){
      const curr = list[i];
      const prev = list[i-1];
      if (curr.ts >= cutoff){
        const dh = (curr.ts - prev.ts)/3600000;
        if (dh >= 0 && isFinite(dh)) samplesH.push(dh);
      }
    }
  }
  samplesH.sort((a,b)=>a-b);
  const n = samplesH.length;
  const p50 = percentile(samplesH, 0.50);
  const p95 = percentile(samplesH, 0.95);
  return { p50, p95, n };
}

(function main(){
  const data = readJSON(ART);
  if (!data) {
    console.error('acceptance_check: missing artifacts/daily_ops.json — run fullchain_check.js first.');
    process.exit(2);
  }

  const k = data.kpi || {};
  const FAIL = data.FAIL || [];
  const WARN = data.WARN || [];

  // 7d 健康
  const m7 = metric7d();

  // TTD 优先用 fullchain_check 计算出的值；如缺，则即时从 ndx 计算
  let ttd_p50 = Number(k.ttd_p50_hours || 0);
  let ttd_p95 = Number(k.ttd_p95_hours || 0);
  let ttd_n   = Number(k.ttd_samples || 0);
  if (!ttd_n || !ttd_p95) {
    const r = computeTTDFromNDX(cfg.TTD_LOOKBACK_HOURS);
    ttd_p50 = r.p50 || 0;
    ttd_p95 = r.p95 || 0;
    ttd_n   = r.n   || 0;
  }

  const failed = [];
  const warns  = [...WARN];

  // A) fullchain_check 的 FAIL 直接阻断
  if (FAIL.length) failed.push(`Fullchain FAIL present: ${FAIL.length} item(s)`);

  // B) 硬阈值
  if ((k.evidence_today || 0) < cfg.TARGET_EVID_TODAY) failed.push(`evidence_today ${k.evidence_today||0} < ${cfg.TARGET_EVID_TODAY}`);
  if ((k.sent_today || 0) < cfg.TARGET_SENT)           failed.push(`sent_today ${k.sent_today||0} < ${cfg.TARGET_SENT}`);
  if ((k.hash_ratio || 0) < cfg.MIN_HASH_RATIO)        failed.push(`hash_ratio ${(k.hash_ratio*100||0).toFixed(1)}% < ${(cfg.MIN_HASH_RATIO*100)}%`);
  if (cfg.REQUIRE_CHANGED_VENDORS && (k.changed_vendors_72h || 0) <= 0) failed.push('changed_vendors_72h = 0');

  // C) 近 7 天健康阈值（有分母才判断）
  if (m7.sent7 > 0) {
    if (m7.unsubRate   > cfg.UNSUB_7D_MAX)     failed.push(`unsub_7d ${(m7.unsubRate*100).toFixed(2)}% > ${(cfg.UNSUB_7D_MAX*100)}% (sent7=${m7.sent7},unsub7=${m7.unsub7})`);
    if (m7.compRate    > cfg.COMPLAINT_7D_MAX) failed.push(`complaint_7d ${(m7.compRate*100).toFixed(2)}% > ${(cfg.COMPLAINT_7D_MAX*100)}% (sent7=${m7.sent7},complaints7=${m7.comp7})`);
    if (m7.bounceRate  > cfg.BOUNCE_7D_MAX)    failed.push(`bounce_7d ${(m7.bounceRate*100).toFixed(2)}% > ${(cfg.BOUNCE_7D_MAX*100)}% (sent7=${m7.sent7},bounces7=${m7.bounce7})`);
  }

  // D) TTD 阈值（样本不足仅 WARN，不阻断）
  if (ttd_n < cfg.MIN_TTD_SAMPLES) {
    warns.push(`TTD samples too low (${ttd_n} < ${cfg.MIN_TTD_SAMPLES}), skip gating`);
  } else if (ttd_p95 > cfg.P95_TTD_MAX_HOURS) {
    failed.push(`ttd_p95 ${ttd_p95.toFixed(1)}h > ${cfg.P95_TTD_MAX_HOURS}h (lookback=${cfg.TTD_LOOKBACK_HOURS}h, n=${ttd_n})`);
    setOutput('reason','ttd_fail');
    setOutput('ttd_p95_hours', ttd_p95.toFixed(2));
    setOutput('ttd_samples', ttd_n);
  }

  const ok = failed.length === 0;

  // Summary（Markdown）
  const md = [
    '### Auto Acceptance',
    `- Date: **${data.date || new Date().toISOString().slice(0,10)}**`,
    `- evidence_today: **${k.evidence_today||0}** / target ${cfg.TARGET_EVID_TODAY}`,
    `- sent_today: **${k.sent_today||0}** / target ${cfg.TARGET_SENT}`,
    `- hash_ratio: **${((k.hash_ratio||0)*100).toFixed(1)}%** / target ${(cfg.MIN_HASH_RATIO*100)}%`,
    `- changed_vendors_72h: **${k.changed_vendors_72h||0}** ${cfg.REQUIRE_CHANGED_VENDORS ? '(must > 0)' : ''}`,
    '',
    `**7-day health (denominator = sent7=${m7.sent7})**`,
    `- unsub_7d: **${m7.unsub7}** (${(m7.unsubRate*100).toFixed(2)}%) / max ${(cfg.UNSUB_7D_MAX*100)}%`,
    `- complaint_7d: **${m7.comp7}** (${(m7.compRate*100).toFixed(2)}%) / max ${(cfg.COMPLAINT_7D_MAX*100)}%`,
    `- bounce_7d: **${m7.bounce7}** (${(m7.bounceRate*100).toFixed(2)}%) / max ${(cfg.BOUNCE_7D_MAX*100)}%`,
    '',
    `**TTD (${cfg.TTD_LOOKBACK_HOURS}h lookback)**`,
    `- P50: **${ttd_p50.toFixed(1)}h**`,
    `- P95: **${ttd_p95.toFixed(1)}h** / max ${cfg.P95_TTD_MAX_HOURS}h`,
    `- samples: **${ttd_n}** (min ${cfg.MIN_TTD_SAMPLES})`,
    '',
    ok ? '✅ **Acceptance: PASS**' : '❌ **Acceptance: FAIL**',
    failed.length ? ('\n**Blocking reasons:**\n- ' + failed.join('\n- ')) : '',
    warns && warns.length ? ('\n**Warnings (not blocking):**\n- ' + warns.join('\n- ')) : ''
  ].join('\n');

  // 控制台输出（去掉加粗符）
  console.log(md.replace(/\*\*/g,''));
  summaryAdd(md);

  process.exit(ok ? 0 : 1);
})();
