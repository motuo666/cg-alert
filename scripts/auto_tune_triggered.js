#!/usr/bin/env node
/**
 * Auto Tune Triggered
 * 目标：把当次触发外呼的 window_h / limit 自动调到“最终入选(final)”落在 8–16 之间
 * 约束：0 成本、仅读仓库内数据（不依赖外部服务），Node 18/20 皆可
 *
 * 输入（可选环境变量）：
 *   TARGET_MIN=8            // 期望最小 final
 *   TARGET_MAX=16           // 期望最大 final
 *   DEFAULT_WINDOW=48       // fallback 窗口（小时）
 *
 * 输出（GitHub Actions 可读）：
 *   window_h=<小时>         // 供 TRIGGER_WINDOW_H 使用
 *   limit=<整数>            // 供 send_triggered.js 的 --limit 使用
 *   reason=<字符串>         // 决策说明
 *
 * 逻辑：
 *   1) 统计 data/evidence.ndx 中最近 N 小时（48/72/96/168）有“真实变更（hash 非空且非全0）”的去重 vendor 数
 *   2) 选择第一个能 ≥ TARGET_MIN 的最小窗口作为 window_h；都达不到则取 168
 *   3) 估算 limit ≈ vendors_in_window * 0.9，并夹在 [max(3, TARGET_MIN), TARGET_MAX]
 *   4) 若今天已经 sent ≥ TARGET_MIN，则本次下调 limit（避免过量）；若 sent 过低，则把 limit 提高到补足阈值
 *   5) 通过 GITHUB_STEP_SUMMARY 输出简报；同时把 window_h/limit 写入 $GITHUB_OUTPUT
 *
 * 兼容性说明：
 *   - evidence.ndx：制表符分隔，至少包含 [date, vendor, type, hash...]，date 为 YYYY-MM-DD
 *   - outreach_log.csv：逗号分隔，可带表头；当日 "status=sent" 行用于“补量/降量”参考
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = p => path.join(ROOT, 'data', p);
const OUT = process.env.GITHUB_OUTPUT;
const STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY;

const TARGET_MIN = +process.env.TARGET_MIN || 8;
const TARGET_MAX = +process.env.TARGET_MAX || 16;
const DEFAULT_WINDOW = +process.env.DEFAULT_WINDOW || 48;

const WINDOWS = [48, 72, 96, 168];

function readLines(fp) {
  try {
    return fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}
function exists(fp) { try { return fs.existsSync(fp); } catch { return false; } }

function parseDateOnly(s) {
  // 允许 "YYYY-MM-DD" 或 "YYYY-MM-DDTHH:MM:SSZ"
  if (!s) return NaN;
  const day = String(s).slice(0, 10);
  const t = Date.parse(day + 'T00:00:00Z');
  return isNaN(t) ? NaN : t;
}
function daysAgo(n) {
  const d = new Date(Date.now() - n * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function hoursAgoTS(h) { return Date.now() - h * 3600 * 1000; }

function uniq(arr) { return Array.from(new Set(arr)); }

function countVendorsByWindow(ndxRows) {
  // rows: [date, vendor, type, hash, ...]
  const results = {};
  for (const W of WINDOWS) {
    const cutoff = hoursAgoTS(W);
    const picked = ndxRows.filter(r => {
      const ts = parseDateOnly(r[0]);
      const hasHash = r[3] && !/^0+$/i.test(String(r[3]).trim());
      return !isNaN(ts) && ts >= cutoff && hasHash;
    });
    results[W] = uniq(picked.map(r => r[1]).filter(Boolean)).length;
  }
  return results;
}

function readEvidenceNDX() {
  const lines = readLines(D('evidence.ndx'));
  return lines.map(l => l.split('\t')).filter(r => r.length >= 2);
}

function readOutreachLogToday() {
  const lines = readLines(D('outreach_log.csv'));
  if (!lines.length) return { sent: 0, dry: 0 };
  let start = 0;
  const first = lines[0].split(',');
  // 判断是否有表头
  if (/^when$/i.test(first[0])) start = 1;
  const today = new Date().toISOString().slice(0, 10);
  let sent = 0, dry = 0;
  for (let i = start; i < lines.length; i++) {
    const cols = csvSplit(lines[i]);
    const when = (cols[0] || '').slice(0, 10);
    const status = (cols[8] || '').trim(); // 'sent' / 'dry'
    if (when === today) {
      if (status === 'sent') sent++;
      else if (status === 'dry') dry++;
    }
  }
  return { sent, dry };
}

// 简易 CSV split（处理逗号与引号）
function csvSplit(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQ = !inQ; }
    } else if (c === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function chooseWindow(vendorCounts) {
  // 返回 { window_h, vendors_in_window }
  for (const W of WINDOWS) {
    if ((vendorCounts[W] || 0) >= TARGET_MIN) return { window_h: W, vendors_in_window: vendorCounts[W] };
  }
  // 都达不到则取 168；若 168 也为 0，就用默认窗口
  if ((vendorCounts[168] || 0) > 0) return { window_h: 168, vendors_in_window: vendorCounts[168] };
  return { window_h: DEFAULT_WINDOW, vendors_in_window: vendorCounts[DEFAULT_WINDOW] || 0 };
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function main() {
  // 读数据
  const ndx = readEvidenceNDX();
  const vendorCounts = countVendorsByWindow(ndx);
  const picked = chooseWindow(vendorCounts);
  let limit = clamp(Math.round(picked.vendors_in_window * 0.9), Math.max(3, TARGET_MIN), TARGET_MAX);
  let reason = `based_on_evidence_${picked.window_h}h_${picked.vendors_in_window}vendors`;

  // 参考“今天已发送量”，做补量/降量
  const { sent: sentToday } = readOutreachLogToday();
  if (sentToday >= TARGET_MIN) {
    // 已经达到最小目标，适度降量
    limit = clamp(Math.round(TARGET_MIN / 2), 3, TARGET_MAX);
    reason += `; reduce_due_to_sent_today_${sentToday}`;
  } else if (sentToday > 0 && sentToday < TARGET_MIN) {
    // 补量到目标（多给 1–2 封容错）
    const topUp = TARGET_MIN - sentToday + 2;
    limit = clamp(Math.max(limit, topUp), 3, TARGET_MAX);
    reason += `; topup_${topUp}_sent_today_${sentToday}`;
  }

  // 没有证据/供应不足时，给一个温和但不为 0 的策略
  if (picked.vendors_in_window === 0) {
    limit = 3;
    reason += '; fallback_no_recent_change';
  }

  // 输出到控制台
  console.log(`[auto-tune] vendors in windows: ${JSON.stringify(vendorCounts)}`);
  console.log(`[auto-tune] chosen window_h=${picked.window_h}, vendors=${picked.vendors_in_window}, limit=${limit}, reason=${reason}`);

  // GitHub Actions outputs
  if (OUT) {
    fs.appendFileSync(OUT, `window_h=${picked.window_h}\n`);
    fs.appendFileSync(OUT, `limit=${limit}\n`);
    fs.appendFileSync(OUT, `reason=${reason}\n`);
  }

  // Step Summary（可视化）
  if (STEP_SUMMARY) {
    const md = [
      `### Auto Tune Triggered`,
      `- Target final: **${TARGET_MIN}–${TARGET_MAX}**`,
      `- Vendors with real changes (hash!=0):`,
      `  - 48h: **${vendorCounts[48] || 0}**`,
      `  - 72h: **${vendorCounts[72] || 0}**`,
      `  - 96h: **${vendorCounts[96] || 0}**`,
      `  - 168h: **${vendorCounts[168] || 0}**`,
      `- Chosen **window_h=${picked.window_h}**, estimated vendors=${picked.vendors_in_window}`,
      `- Output **limit=${limit}**`,
      `- Reason: ${reason}`
    ].join('\n');
    fs.appendFileSync(STEP_SUMMARY, md + '\n');
  }
}

main();
