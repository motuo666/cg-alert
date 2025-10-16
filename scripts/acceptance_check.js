#!/usr/bin/env node
/**
 * Auto Acceptance Gate（覆盖版·含 7 天健康阈值）
 *
 * 用法：在 Auto Acceptance 工作流中，先运行 fullchain_check.js 产出 artifacts/daily_ops.json，
 * 再运行本脚本。本脚本会把结论写到 GITHUB_STEP_SUMMARY，并用退出码控制通过/失败。
 *
 * 判定逻辑（任一命中即 FAIL）：
 *  A) fullchain_check 的 FAIL 列表非空（链接错误 / 抑制未生效 / 回写失败等）
 *  B) 硬阈值未达：evidence_today / sent_today / hash_ratio / changed_vendors_72h
 *  C) 近 7 天健康阈值：退订、投诉、退信比例超出上限（分母=近 7 天 sent）
 *
 * 环境变量（可不设使用默认值）：
 *  TARGET_SENT=8
 *  TARGET_EVID_TODAY=10
 *  MIN_HASH_RATIO=0.4                // 40%
 *  REQUIRE_CHANGED_VENDORS=1         // 是否要求 72h 内必须有变化的厂商
 *  UNSUB_7D_MAX=0.005                // 0.5%
 *  COMPLAINT_7D_MAX=0.001            // 0.1%
 *  BOUNCE_7D_MAX=0.08                // 8%（只是红线，过高会影响送达）
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
};

function readText(fp){ try { return fs.readFileSync(fp,'utf8'); } catch { return ''; } }
function readJSON(fp){ try { return JSON.parse(readText(fp)); } catch { return null; } }
function exists(fp){ try { return fs.existsSync(fp); } catch { return false; } }
function summaryAdd(md){ if(process.env.GITHUB_STEP_SUMMARY){ fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } }

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
  // 尝试 ISO / RFC / 日期
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  // 行内任意单元格若包含 ISO 日期
  const m = s.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?/);
  if (m) {
    const t2 = Date.parse(m[0]);
    if (!Number.isNaN(t2)) return t2;
  }
  return NaN;
}

function withinDays(ts, days){
  if (Number.isNaN(ts)) return false;
  const cutoff = Date.now() - days*24*3600*1000;
  return ts >= cutoff;
}

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

  // 分子：unsub / complaints / bounces（来自对应 CSV；没有或无时间戳则不计入 7d）
  function count7d(fp, colWhenGuess=0){
    const t = parseCSV(fp);
    if (!t.rows.length) return 0;
    // 尝试定位 when 列
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

  // 比例（分母为 0 时，视为 0，不阻断）
  const pct = (x) => (sent7>0 ? x/sent7 : 0);

  return {
    sent7,
    unsub7,
    comp7,
    bounce7,
    unsubRate: pct(unsub7),
    compRate:  pct(comp7),
    bounceRate:pct(bounce7),
  };
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

  const failed = [];

  // A) fullchain_check 的 FAIL 直接阻断
  if (FAIL.length) failed.push(`Fullchain FAIL present: ${FAIL.length} item(s)`);

  // B) 硬阈值
  if ((k.evidence_today || 0) < cfg.TARGET_EVID_TODAY) failed.push(`evidence_today ${k.evidence_today||0} < ${cfg.TARGET_EVID_TODAY}`);
  if ((k.sent_today || 0) < cfg.TARGET_SENT)           failed.push(`sent_today ${k.sent_today||0} < ${cfg.TARGET_SENT}`);
  if ((k.hash_ratio || 0) < cfg.MIN_HASH_RATIO)        failed.push(`hash_ratio ${(k.hash_ratio*100||0).toFixed(1)}% < ${(cfg.MIN_HASH_RATIO*100)}%`);
  if (cfg.REQUIRE_CHANGED_VENDORS && (k.changed_vendors_72h || 0) <= 0) failed.push('changed_vendors_72h = 0');

  // C) 近 7 天健康阈值（有分母才判断）
  const m7 = metric7d();
  if (m7.sent7 > 0) {
    if (m7.unsubRate   > cfg.UNSUB_7D_MAX)     failed.push(`unsub_7d ${(m7.unsubRate*100).toFixed(2)}% > ${(cfg.UNSUB_7D_MAX*100)}% (sent7=${m7.sent7},unsub7=${m7.unsub7})`);
    if (m7.compRate    > cfg.COMPLAINT_7D_MAX) failed.push(`complaint_7d ${(m7.compRate*100).toFixed(2)}% > ${(cfg.COMPLAINT_7D_MAX*100)}% (sent7=${m7.sent7},complaints7=${m7.comp7})`);
    if (m7.bounceRate  > cfg.BOUNCE_7D_MAX)    failed.push(`bounce_7d ${(m7.bounceRate*100).toFixed(2)}% > ${(cfg.BOUNCE_7D_MAX*100)}% (sent7=${m7.sent7},bounces7=${m7.bounce7})`);
  }

  const ok = failed.length === 0;

  // Summary（Markdown）
  const md = [
    '### Auto Acceptance',
    `- Date: **${data.date}**`,
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
    ok ? '✅ **Acceptance: PASS**' : '❌ **Acceptance: FAIL**',
    failed.length ? ('\n**Blocking reasons:**\n- ' + failed.join('\n- ')) : '',
    WARN && WARN.length ? ('\n**Warnings (not blocking):**\n- ' + WARN.join('\n- ')) : ''
  ].join('\n');

  // 控制台输出（去掉加粗符）
  console.log(md.replace(/\*\*/g,''));
  summaryAdd(md);

  process.exit(ok ? 0 : 1);
})();
