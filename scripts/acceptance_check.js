#!/usr/bin/env node
/**
 * Auto Acceptance Gate (覆盖版 · KPI-7d 修正 + burn-in)
 *
 * 作用：
 * - 把每日/近72h KPI 与投递健康（近7日）做“硬闸门”
 * - 纠正 7d 指标口径（仅统计「近7日内、且发生在该邮箱最后一次发送之后」的退订/退信/投诉）
 * - 冷启动/低样本时只 WARN 不 FAIL（burn-in）
 *
 * 读取优先级：
 * 1) artifacts/daily_ops.json（由 fullchain_check.js 产出，含 ttd/p50/p95 等）
 * 2) 若缺失/字段不足，则从 data/*.csv/ndx 容错提取
 *
 * 环境变量（可通过 Actions → Variables 配置；括号内为默认）：
 * - TARGET_SENT (8)                 ：当日最小有效发送
 * - TARGET_EVID_TODAY (10)          ：当日最小新增证据
 * - MIN_HASH_RATIO (0.4)            ：hash 覆盖率下限（0~1）
 * - REQUIRE_CHANGED_VENDORS (1)     ：是否要求近72h有变更厂商（0/1）
 * - P95_TTD_MAX_HOURS (24)          ：P95 检测时延上限
 * - MIN_TTD_SAMPLES (10)            ：TTD 样本最小值（不足只 WARN）
 * - TTD_LOOKBACK_HOURS (72)         ：TTD 统计窗口
 * - DLVR_LOOKBACK_DAYS (7)          ：投递健康统计窗口（天）
 * - MIN_SENT7_FOR_DLVR (100)        ：近7日最小有效发送（低于仅 WARN）
 * - UNSUB_7D_MAX (0.005)            ：退订上限（7d）
 * - COMPLAINT_7D_MAX (0.001)        ：投诉上限（7d）
 * - BOUNCE_7D_MAX (0.08)            ：退信上限（7d）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = (...p) => path.join(ROOT, 'data', ...p);
const R = (...p) => path.join(ROOT, ...p);

const cfg = {
  TARGET_SENT: num(process.env.TARGET_SENT, 8),
  TARGET_EVID_TODAY: num(process.env.TARGET_EVID_TODAY, 10),
  MIN_HASH_RATIO: num(process.env.MIN_HASH_RATIO, 0.4),
  REQUIRE_CHANGED_VENDORS: num(process.env.REQUIRE_CHANGED_VENDORS, 1),

  P95_TTD_MAX_HOURS: num(process.env.P95_TTD_MAX_HOURS, 24),
  MIN_TTD_SAMPLES: num(process.env.MIN_TTD_SAMPLES, 10),
  TTD_LOOKBACK_HOURS: num(process.env.TTD_LOOKBACK_HOURS, 72),

  DLVR_LOOKBACK_DAYS: num(process.env.DLVR_LOOKBACK_DAYS, 7),
  MIN_SENT7_FOR_DLVR: num(process.env.MIN_SENT7_FOR_DLVR, 100),
  UNSUB_7D_MAX: num(process.env.UNSUB_7D_MAX, 0.005),
  COMPLAINT_7D_MAX: num(process.env.COMPLAINT_7D_MAX, 0.001),
  BOUNCE_7D_MAX: num(process.env.BOUNCE_7D_MAX, 0.08),
};

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function readJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function readLines(fp) {
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter(Boolean);
}

function csvRows(fp) {
  return readLines(fp).map(l => l.split(/,(?!\s)/)); // 容错分割
}

function appendSummary(md) {
  const sum = process.env.GITHUB_STEP_SUMMARY;
  if (sum) fs.appendFileSync(sum, md + '\n', 'utf8');
}

function fmtPct(x) {
  if (!isFinite(x)) return '0.00%';
  return (100 * x).toFixed(2) + '%';
}

function isoOrNull(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** 在一行数组中找 email/when/status 的容错解析 */
function parseOutreachRow(cols) {
  let whenTs = null, email = null, status = null;
  for (const c of cols) {
    const v = (c || '').trim();
    if (!whenTs && /\d{4}-\d{2}-\d{2}T/.test(v)) {
      const ts = isoOrNull(v); if (ts) whenTs = ts;
    }
    if (!email && /@/.test(v) && !/\s/.test(v)) {
      email = v;
    }
    if (!status && /^(sent|dry)$/i.test(v)) {
      status = v.toLowerCase();
    }
  }
  // 兜底：时间可能在首列
  if (!whenTs) {
    const ts = isoOrNull(cols[0]);
    if (ts) whenTs = ts;
  }
  return { whenTs, email, status };
}

/** 抑制表行解析：优先找 ISO 时间戳、其次第一列 */
function parseSuppRow(cols) {
  let whenTs = null, email = null;
  for (const c of cols) {
    const v = (c || '').trim();
    if (!whenTs && /\d{4}-\d{2}-\d{2}T/.test(v)) {
      const ts = isoOrNull(v); if (ts) whenTs = ts;
    }
    if (!email && /@/.test(v) && !/\s/.test(v)) {
      email = v;
    }
  }
  if (!whenTs) {
    const ts = isoOrNull(cols[0]);
    if (ts) whenTs = ts;
  }
  // 有些表只有 email 一列
  if (!email && cols.length) {
    const c0 = (cols[0] || '').trim();
    if (/@/.test(c0)) email = c0;
  }
  return { whenTs, email };
}

/** 从 artifacts/daily_ops.json 或数据文件提 KPI（尽可能容错） */
function loadKPIs() {
  const today = new Date().toISOString().slice(0, 10);
  const ops = readJSON(R('artifacts', 'daily_ops.json')) || {};
  const kpi = Object.assign({},
    ops.kpi || {},
    { date: ops.date || today }
  );

  // 填补 evidence_today/evidence_total/hash_ratio from ndx（如缺）
  if (!Number.isFinite(kpi.evidence_today) || !Number.isFinite(kpi.evidence_total) || !Number.isFinite(kpi.hash_ratio)) {
    const ndx = readLines(D('evidence.ndx')).map(l => l.split('\t'));
    const total = ndx.length;
    const todayN = ndx.filter(r => (r[0] || '').startsWith(today)).length;
    const hashOK = ndx.filter(r => r[3] && !/^0+$/i.test(String(r[3]))).length;
    if (!Number.isFinite(kpi.evidence_total)) kpi.evidence_total = total;
    if (!Number.isFinite(kpi.evidence_today)) kpi.evidence_today = todayN;
    if (!Number.isFinite(kpi.hash_ratio)) kpi.hash_ratio = total ? (hashOK / total) : 0;
  }

  if (!Number.isFinite(kpi.sent_today) || !Number.isFinite(kpi.changed_vendors_72h)) {
    // sent_today 从 outreach_log 估；changed_vendors_72h 简化为 ndx 最近72h的 vendor 数
    const out = csvRows(D('outreach_log.csv'));
    const header = out[0] && /^when$/i.test((out[0][0] || '').trim());
    const rows = header ? out.slice(1) : out;
    const sentToday = rows.filter(cols => {
      const { whenTs, status } = parseOutreachRow(cols);
      const d = whenTs ? new Date(whenTs).toISOString().slice(0, 10) : '';
      return d === today && status === 'sent';
    }).length;
    if (!Number.isFinite(kpi.sent_today)) kpi.sent_today = sentToday;

    const now = Date.now(), look72 = now - cfg.TTD_LOOKBACK_HOURS * 3600 * 1000;
    const ndx = readLines(D('evidence.ndx')).map(l => l.split('\t'));
    const vendors = new Set();
    for (const r of ndx) {
      const ts = isoOrNull((r[0] || '').trim() + 'T00:00:00Z');
      if (ts && ts >= look72) vendors.add(r[1] || '');
    }
    if (!Number.isFinite(kpi.changed_vendors_72h)) kpi.changed_vendors_72h = vendors.size;
  }

  // TTD（优先用 daily_ops；否则置 0 并在后面按样本不足处理）
  if (!Number.isFinite(kpi.ttd_p50_hours)) kpi.ttd_p50_hours = 0;
  if (!Number.isFinite(kpi.ttd_p95_hours)) kpi.ttd_p95_hours = 0;
  if (!Number.isFinite(kpi.ttd_samples)) kpi.ttd_samples = 0;

  return kpi;
}

/** 计算近7日投递健康（修正口径 + burn-in） */
function compute7dDelivery() {
  const now = Date.now();
  const look = now - cfg.DLVR_LOOKBACK_DAYS * 86400 * 1000;

  const out = csvRows(D('outreach_log.csv'));
  const header = out[0] && /^when$/i.test((out[0][0] || '').trim());
  const rows = header ? out.slice(1) : out;

  // 近7日 sent & 每邮箱最近一次 sent 时间
  let sent7 = 0;
  const lastSent = new Map(); // email -> ts
  for (const cols of rows) {
    const { whenTs, email, status } = parseOutreachRow(cols);
    if (!whenTs || !email || status !== 'sent') continue;
    if (whenTs >= look) {
      sent7++;
      const prev = lastSent.get(email) || 0;
      if (whenTs > prev) lastSent.set(email, whenTs);
    }
  }

  // 读取抑制表
  const unsubsRows = csvRows(D('unsubscribes.csv'));
  const bouncesRows = csvRows(D('bounces.csv'));
  const complaintsRows = csvRows(D('complaints.csv')); // 可不存在

  let unsub7 = 0, bounce7 = 0, complaint7 = 0;
  let unsubNoTs = 0, bounceNoTs = 0, complaintNoTs = 0;

  for (const cols of unsubsRows.slice(1)) { // 可能有表头，丢一行也无所谓
    const { whenTs, email } = parseSuppRow(cols);
    if (!email) continue;
    if (!whenTs) { unsubNoTs++; continue; }
    if (whenTs >= look && (!lastSent.has(email) || whenTs >= lastSent.get(email))) unsub7++;
  }
  for (const cols of bouncesRows.slice(1)) {
    const { whenTs, email } = parseSuppRow(cols);
    if (!email) continue;
    if (!whenTs) { bounceNoTs++; continue; }
    if (whenTs >= look && (!lastSent.has(email) || whenTs >= lastSent.get(email))) bounce7++;
  }
  for (const cols of complaintsRows.slice(1)) {
    const { whenTs, email } = parseSuppRow(cols);
    if (!email) continue;
    if (!whenTs) { complaintNoTs++; continue; }
    if (whenTs >= look && (!lastSent.has(email) || whenTs >= lastSent.get(email))) complaint7++;
  }

  const result = {
    sent7,
    unsub7,
    bounce7,
    complaint7,
    unsubRate: sent7 > 0 ? unsub7 / sent7 : 0,
    bounceRate: sent7 > 0 ? bounce7 / sent7 : 0,
    complaintRate: sent7 > 0 ? complaint7 / sent7 : 0,
    unsubNoTs, bounceNoTs, complaintNoTs,
  };
  return result;
}

function main() {
  const k = loadKPIs();
  const FAIL = [];
  const WARN = [];

  // 读取 fullchain 自身 FAIL 列表（如有）
  const ops = readJSON(R('artifacts', 'daily_ops.json')) || {};
  if (ops.FAIL && ops.FAIL.length) FAIL.push(`Fullchain FAIL present: ${ops.FAIL.length} item(s)`);

  // 当日硬指标
  if ((k.evidence_today || 0) < cfg.TARGET_EVID_TODAY) FAIL.push(`evidence_today ${k.evidence_today || 0} < ${cfg.TARGET_EVID_TODAY}`);
  if ((k.sent_today || 0) < cfg.TARGET_SENT) FAIL.push(`sent_today ${k.sent_today || 0} < ${cfg.TARGET_SENT}`);
  if (cfg.REQUIRE_CHANGED_VENDORS && (k.changed_vendors_72h || 0) <= 0) FAIL.push('changed_vendors_72h = 0');
  if ((k.hash_ratio || 0) < cfg.MIN_HASH_RATIO) FAIL.push(`hash_ratio ${((k.hash_ratio || 0) * 100).toFixed(1)}% < ${(cfg.MIN_HASH_RATIO * 100)}%`);

  // TTD 门槛（样本不足只 WARN）
  let ttdFail = false;
  if ((k.ttd_samples || 0) < cfg.MIN_TTD_SAMPLES) {
    WARN.push(`TTD samples too low (${k.ttd_samples || 0} < ${cfg.MIN_TTD_SAMPLES}), skip gating`);
  } else if ((k.ttd_p95_hours || 0) > cfg.P95_TTD_MAX_HOURS) {
    FAIL.push(`P95 TTD ${k.ttd_p95_hours.toFixed(1)}h > ${cfg.P95_TTD_MAX_HOURS}h`);
    ttdFail = true;
  }

  // 7d 投递健康（修正 + burn-in）
  const d7 = compute7dDelivery();
  const gateDlvr = d7.sent7 >= cfg.MIN_SENT7_FOR_DLVR;
  if (!gateDlvr) {
    WARN.push(`7d deliverability burn-in (sent7=${d7.sent7} < ${cfg.MIN_SENT7_FOR_DLVR})`);
  }
  if ((d7.unsubNoTs + d7.bounceNoTs + d7.complaintNoTs) > 0) {
    WARN.push(`suppression rows without timestamp: unsub=${d7.unsubNoTs}, bounce=${d7.bounceNoTs}, complaint=${d7.complaintNoTs}`);
  }
  if (gateDlvr) {
    if (d7.unsubRate > cfg.UNSUB_7D_MAX) FAIL.push(`unsub_7d ${fmtPct(d7.unsubRate)} > ${fmtPct(cfg.UNSUB_7D_MAX)} (sent7=${d7.sent7},unsub7=${d7.unsub7})`);
    if (d7.complaintRate > cfg.COMPLAINT_7D_MAX) FAIL.push(`complaint_7d ${fmtPct(d7.complaintRate)} > ${fmtPct(cfg.COMPLAINT_7D_MAX)} (sent7=${d7.sent7},complaints7=${d7.complaint7})`);
    if (d7.bounceRate > cfg.BOUNCE_7D_MAX) FAIL.push(`bounce_7d ${fmtPct(d7.bounceRate)} > ${fmtPct(cfg.BOUNCE_7D_MAX)} (sent7=${d7.sent7},bounces7=${d7.bounce7})`);
  }

  // Summary 输出
  const lines = [];
  lines.push('### Auto Acceptance (with KPI-7d fix + burn-in)');
  lines.push(`- Date: **${k.date}**`);
  lines.push(`- evidence_today: **${k.evidence_today || 0}** / target ${cfg.TARGET_EVID_TODAY}`);
  lines.push(`- sent_today: **${k.sent_today || 0}** / target ${cfg.TARGET_SENT}`);
  lines.push(`- hash_ratio: **${((k.hash_ratio || 0) * 100).toFixed(1)}%** / target ${(cfg.MIN_HASH_RATIO * 100)}%`);
  lines.push(`- changed_vendors_72h: **${k.changed_vendors_72h || 0}** ${cfg.REQUIRE_CHANGED_VENDORS ? '(must > 0)' : ''}`);
  lines.push(`- TTD (lookback ${cfg.TTD_LOOKBACK_HOURS}h): P50 **${(k.ttd_p50_hours || 0).toFixed(1)}h**, P95 **${(k.ttd_p95_hours || 0).toFixed(1)}h**, samples **${k.ttd_samples || 0}** (min ${cfg.MIN_TTD_SAMPLES})`);
  lines.push(`- 7d: sent **${d7.sent7}** | unsub **${d7.unsub7} (${fmtPct(d7.unsubRate)})** | bounce **${d7.bounce7} (${fmtPct(d7.bounceRate)})** | complaint **${d7.complaint7} (${fmtPct(d7.complaintRate)})** ${gateDlvr ? '' : `(burn-in: sent7<${cfg.MIN_SENT7_FOR_DLVR})`}`);

  const ok = FAIL.length === 0;
  lines.push(ok ? '\n✅ Acceptance: **PASS**' : '\n❌ Acceptance: **FAIL**');
  if (FAIL.length) {
    lines.push('\n**Blocking reasons:**');
    for (const s of FAIL) lines.push(`- ${s}`);
  }
  if (WARN.length) {
    lines.push('\n**Warnings (not blocking):**');
    for (const s of WARN) lines.push(`- ${s}`);
  }
  // 标记 TTD 失败（供 workflow 钩子判断）
  if (ttdFail) lines.push('\n`TTD_FAIL_MARKER`');

  const md = lines.join('\n');
  console.log(md.replace(/\*\*/g, '')); // 控制台去粗体
  appendSummary(md);

  process.exit(ok ? 0 : 1);
}

main();
