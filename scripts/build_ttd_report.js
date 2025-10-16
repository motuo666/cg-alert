#!/usr/bin/env node
/**
 * build_ttd_report.js  —  TTD（Time-to-Detect）报告生成器（覆盖版）
 *
 * 目标：
 *  - 计算最近窗口（默认 72h）内的 TTD 分布（P50/P95），仅统计“真实变更”（排除 baseline）
 *  - 生成机器可读与人类可读的报告：
 *      - reports/ops/ttd.json
 *      - reports/ops/ttd.html
 *  - 若存在 artifacts/daily_ops.json，则把 ttd 指标写回，便于 Auto Acceptance/可视化复用
 *
 * 环境变量（可选）：
 *  - TTD_LOOKBACK_HOURS  默认 72   // 统计窗口
 *  - MIN_TTD_SAMPLES     默认 10   // 样本不足仅告警不阻断（供外部脚本参考）
 *
 * 取值策略（稳健）：
 *  - observed_at：优先 evidence JSON 的 observed_at/fetched_at；否则用文件路径中的 YYYY-MM-DD（等价 0 时延）
 *  - source_date：优先 evidence JSON 的 effective_date/source_last_modified/date/page_last_modified
 *  - 只纳入 “真实变更” 样本：j.kind!=='baseline' 且 hash 存在且非 0 串
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVD_DIR = path.join(ROOT, 'evidence');
const OUT_DIR = path.join(ROOT, 'reports', 'ops');
const ART_DIR = path.join(ROOT, 'artifacts');
const ART_DAILY = path.join(ART_DIR, 'daily_ops.json');

const LOOKBACK_H = Number(process.env.TTD_LOOKBACK_HOURS || 72);
const MIN_SAMPLES = Number(process.env.MIN_TTD_SAMPLES || 10);

function walkJSON(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJSON(p, acc);
    else if (ent.isFile() && ent.name.endsWith('.json')) acc.push(p);
  }
  return acc;
}

function parseISO(s) {
  if (!s) return null;
  // 支持纯日期 YYYY-MM-DD、ISO、或时间戳字符串
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00Z');
  const n = Number(s);
  if (!Number.isNaN(n) && n > 0) {
    const d = new Date(n);
    return Number.isNaN(+d) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(+d) ? null : d;
}

function dateFromPath(fp) {
  const m = fp.match(/(\d{4}-\d{2}-\d{2})-/);
  if (!m) return null;
  return new Date(m[1] + 'T00:00:00Z');
}

function isNonZeroHash(h) {
  if (!h) return false;
  const s = String(h).trim();
  if (!s) return false;
  // 允许 sha256/sha1/短哈：“sha256:xxxx” 或 64/40/8十六进制
  const hex = s.replace(/^sha(1|256):/i, '');
  return !/^0+$/i.test(hex);
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const n = sortedArr.length;
  const idx = Math.max(0, Math.min(n - 1, Math.floor((p / 100) * (n - 1))));
  return sortedArr[idx];
}

function hoursBetween(a, b) {
  return Math.max(0, (a - b) / 3600000);
}

function withinLookback(d) {
  if (!d) return false;
  const now = Date.now();
  return (now - d.getTime()) <= LOOKBACK_H * 3600000;
}

function loadJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return null; }
}

function safeWriteJSON(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2));
}

function run() {
  const files = walkJSON(EVD_DIR);
  const samples = [];

  for (const fp of files) {
    const j = loadJSON(fp);
    if (!j) continue;

    // 只统计真实变更：排除 baseline / 空 hash
    const kind = String(j.kind || '').toLowerCase();
    const hash = j.hash || j.fingerprint || j.sha256;
    if (kind === 'baseline') continue;
    if (!isNonZeroHash(hash)) continue;

    // 源日期：页面宣称的“生效/最后修改/日期”
    const source =
      parseISO(j.effective_date) ||
      parseISO(j.source_last_modified) ||
      parseISO(j.page_last_modified) ||
      parseISO(j.date);
    if (!source) continue;

    // 观测时间：我们抓到/记录的时间
    const observed =
      parseISO(j.observed_at) ||
      parseISO(j.fetched_at) ||
      dateFromPath(fp);
    if (!observed) continue;

    // 仅纳入“最近窗口”的样本（根据 observed）
    if (!withinLookback(observed)) continue;

    samples.push(hoursBetween(observed, source));
  }

  samples.sort((a, b) => a - b);
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);

  const summary = {
    window_hours: LOOKBACK_H,
    samples: samples.length,
    p50_hours: Math.round(p50 * 10) / 10,
    p95_hours: Math.round(p95 * 10) / 10,
    generated_at: new Date().toISOString(),
    note: samples.length < MIN_SAMPLES
      ? `samples<${MIN_SAMPLES} (warn only)`
      : 'ok'
  };

  // 输出 JSON
  safeWriteJSON(path.join(OUT_DIR, 'ttd.json'), summary);

  // 输出 HTML
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Time to Detect (TTD)</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui,Arial;padding:24px;max-width:900px;margin:auto;line-height:1.6}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.badge{display:inline-block;background:#f3f4f6;border-radius:999px;padding:4px 10px;margin-right:8px}
.kv{display:flex;justify-content:space-between;border-bottom:1px dashed #eee;padding:6px 0}
small{color:#6b7280}
.bar{height:8px;background:#eee;border-radius:6px;overflow:hidden}
.fill{height:8px;background:#222;border-radius:6px}
</style></head>
<body>
<h1>Time to Detect (TTD)</h1>
<div class="card">
  <div class="badge">Window: <b>${summary.window_hours}h</b></div>
  <div class="badge">Samples: <b>${summary.samples}</b></div>
  <div class="badge">P50: <b>${summary.p50_hours}h</b></div>
  <div class="badge">P95: <b>${summary.p95_hours}h</b></div>
  <p><small>Definition — Hours between a source page's effective/last-modified date and our observed timestamp, within the last ${summary.window_hours} hours. Baseline (non-change) samples are excluded.</small></p>
</div>

<div class="card">
  <h3>Quick gauge</h3>
  <div class="kv"><div>P50 target</div><div>&lt;= 12h</div></div>
  <div class="bar"><div class="fill" style="width:${Math.min(100, (summary.p50_hours/12)*100)}%"></div></div>
  <div class="kv" style="margin-top:10px"><div>P95 target</div><div>&lt;= 24h</div></div>
  <div class="bar"><div class="fill" style="width:${Math.min(100, (summary.p95_hours/24)*100)}%"></div></div>
  <p><small>${summary.note}</small></p>
</div>

<div class="card">
  <h3>How it's computed</h3>
  <ul>
    <li>Only real changes are counted (exclude baseline / empty hashes).</li>
    <li>Observed time: <code>observed_at</code> → <code>fetched_at</code> → filename date.</li>
    <li>Source date: <code>effective_date</code> → <code>source_last_modified</code> → <code>page_last_modified</code> → <code>date</code>.</li>
    <li>Window: last ${summary.window_hours} hours.</li>
  </ul>
</div>
</body></html>`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'ttd.html'), html, 'utf8');

  // 回写到 artifacts/daily_ops.json（若存在）
  try {
    if (fs.existsSync(ART_DAILY)) {
      const daily = JSON.parse(fs.readFileSync(ART_DAILY, 'utf8'));
      daily.kpi = daily.kpi || {};
      daily.kpi.ttd_p50_hours = summary.p50_hours || 0;
      daily.kpi.ttd_p95_hours = summary.p95_hours || 0;
      daily.kpi.ttd_samples = summary.samples || 0;
      fs.mkdirSync(ART_DIR, { recursive: true });
      fs.writeFileSync(ART_DAILY, JSON.stringify(daily, null, 2));
    }
  } catch {}

  console.log(`TTD report -> samples=${summary.samples}, P50=${summary.p50_hours}h, P95=${summary.p95_hours}h, window=${summary.window_hours}h`);
}

run();
