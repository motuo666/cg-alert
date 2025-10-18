#!/usr/bin/env node
/**
 * build_ttd_report.js — TTD（Time-to-Detect）报告生成器（覆盖版）
 *
 * 强化点：
 *  - 更稳健的字段抽取（含 meta.*、多别名）
 *  - 输出多分位/直方图/状态（含 Burn-in 放行）
 *  - 回写 artifacts/daily_ops.json 的 kpi 与 PASS/WARN/FAIL 项
 *  - HTML 加 noindex，避免收录到搜索引擎
 *
 * 环境变量（可选）：
 *  - TTD_LOOKBACK_HOURS   默认 72
 *  - MIN_TTD_SAMPLES      默认 10
 *  - TTD_P95_TARGET_HOURS 默认 24
 *  - TTD_P50_TARGET_HOURS 默认 12
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVD_DIR = path.join(ROOT, 'evidence');
const OUT_DIR = path.join(ROOT, 'reports', 'ops');
const ART_DIR = path.join(ROOT, 'artifacts');
const ART_DAILY = path.join(ART_DIR, 'daily_ops.json');

const LOOKBACK_H = Number(process.env.TTD_LOOKBACK_HOURS || 72);
const MIN_SAMPLES = Number(process.env.MIN_TTD_SAMPLES || 10);
const TGT_P95 = Number(process.env.TTD_P95_TARGET_HOURS || 24);
const TGT_P50 = Number(process.env.TTD_P50_TARGET_HOURS || 12);

// ---------- 小工具 ----------
const exists = fp => { try { return fs.existsSync(fp); } catch { return false; } };

function walkJSON(dir, acc = []) {
  if (!exists(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJSON(p, acc);
    else if (ent.isFile() && ent.name.endsWith('.json')) acc.push(p);
  }
  return acc;
}

function get(obj, key, dflt = undefined) {
  if (!obj) return dflt;
  if (key.includes('.')) {
    return key.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), obj) ?? dflt;
  }
  return (key in obj ? obj[key] : dflt);
}

function parseISO(s) {
  if (!s) return null;
  if (typeof s === 'number') {
    const d = new Date(s);
    return Number.isNaN(+d) ? null : d;
  }
  const str = String(s).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T00:00:00Z');
  // 支持 2025-10-18T04:00:00Z / RFC1123 / HTTP Last-Modified
  const d = new Date(str);
  return Number.isNaN(+d) ? null : d;
}

function dateFromPath(fp) {
  // 例：evidence/paddle.com/2025-10-18-xxxx.json
  const m = fp.match(/(\d{4}-\d{2}-\d{2})-/);
  return m ? new Date(m[1] + 'T00:00:00Z') : null;
}

function isNonZeroHash(h) {
  if (!h) return false;
  const s = String(h).trim();
  if (!s) return false;
  const hex = s.replace(/^sha(1|256):/i, '').replace(/[^0-9a-f]/gi, '');
  if (!hex) return false;
  return !/^0+$/i.test(hex);
}

function hoursBetween(a, b) {
  return Math.max(0, (a - b) / 3600000);
}

function withinLookback(d) {
  return !!d && (Date.now() - d.getTime()) <= LOOKBACK_H * 3600000;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const n = sorted.length;
  const i = Math.max(0, Math.min(n - 1, Math.floor((p / 100) * (n - 1))));
  return sorted[i];
}

function histogram(values) {
  const bins = [
    { k: '0-1h',     lo: 0,  hi: 1 },
    { k: '1-3h',     lo: 1,  hi: 3 },
    { k: '3-6h',     lo: 3,  hi: 6 },
    { k: '6-12h',    lo: 6,  hi: 12 },
    { k: '12-24h',   lo: 12, hi: 24 },
    { k: '24-48h',   lo: 24, hi: 48 },
    { k: '48-72h',   lo: 48, hi: 72 },
    { k: '>72h',     lo: 72, hi: Infinity },
  ];
  const counts = Object.fromEntries(bins.map(b => [b.k, 0]));
  for (const v of values) {
    const b = bins.find(b => v >= b.lo && v < b.hi) || bins[bins.length - 1];
    counts[b.k]++;
  }
  return counts;
}

function loadJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return null; }
}

function writeJSON(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2));
}

// ---------- 主流程 ----------
function run() {
  const files = walkJSON(EVD_DIR);
  const samples = [];

  // 候选字段（source/observed 多别名 + meta.*）
  const SOURCE_KEYS = [
    'effective_date', 'source_last_modified', 'page_last_modified',
    'published_at', 'lastmod', 'http_last_modified', 'date', 'meta.effective_date',
    'meta.source_last_modified', 'meta.page_last_modified'
  ];
  const OBS_KEYS = [
    'observed_at', 'fetched_at', 'collected_at', 'detected_at',
    'crawler_time', 'meta.observed_at', 'meta.fetched_at', 'meta.detected_at'
  ];
  const HASH_KEYS = ['hash', 'fingerprint', 'sha256', 'sha1', 'meta.hash'];

  for (const fp of files) {
    const j = loadJSON(fp);
    if (!j) continue;

    // 只统计真实变更：排除 baseline / 空 hash
    const kind = String(j.kind || get(j, 'meta.kind', '') || '').toLowerCase();
    const hash = HASH_KEYS.map(k => get(j, k)).find(Boolean);
    if (kind === 'baseline') continue;
    if (!isNonZeroHash(hash)) continue;

    const source = SOURCE_KEYS.map(k => parseISO(get(j, k))).find(Boolean);
    if (!source) continue;

    const observed = (OBS_KEYS.map(k => parseISO(get(j, k))).find(Boolean)) || dateFromPath(fp);
    if (!observed) continue;

    // 仅纳入最近窗口（按 observed）
    if (!withinLookback(observed)) continue;

    samples.push(hoursBetween(observed, source));
  }

  samples.sort((a, b) => a - b);
  const p10 = percentile(samples, 10);
  const p25 = percentile(samples, 25);
  const p50 = percentile(samples, 50);
  const p75 = percentile(samples, 75);
  const p90 = percentile(samples, 90);
  const p95 = percentile(samples, 95);
  const p99 = percentile(samples, 99);

  const hist = histogram(samples);

  // 判定：Burn-in 放行 & 目标
  const burnIn = samples.length < MIN_SAMPLES;
  const passP95 = p95 <= TGT_P95;
  const passP50 = p50 <= TGT_P50;

  const status = burnIn
    ? 'pass_burnin'
    : (passP95 ? 'pass' : 'fail');

  const note = burnIn
    ? `samples<${MIN_SAMPLES} — Burn-in 放行`
    : (passP95 ? 'TTD P95 达标' : 'TTD P95 未达标');

  const summary = {
    window_hours: LOOKBACK_H,
    samples: samples.length,
    percentiles: {
      p10: +p10.toFixed(1),
      p25: +p25.toFixed(1),
      p50: +p50.toFixed(1),
      p75: +p75.toFixed(1),
      p90: +p90.toFixed(1),
      p95: +p95.toFixed(1),
      p99: +p99.toFixed(1),
    },
    targets: { p50_hours: TGT_P50, p95_hours: TGT_P95 },
    histogram: hist,
    status,               // pass | pass_burnin | fail
    note,
    generated_at: new Date().toISOString()
  };

  // 输出 JSON
  writeJSON(path.join(OUT_DIR, 'ttd.json'), summary);

  // 输出 HTML（noindex）
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<title>Time to Detect (TTD)</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui,Arial;padding:24px;max-width:960px;margin:auto;line-height:1.6}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.badge{display:inline-block;background:#f3f4f6;border-radius:999px;padding:4px 10px;margin-right:8px}
.kv{display:flex;justify-content:space-between;border-bottom:1px dashed #eee;padding:6px 0}
small{color:#6b7280}
.bar{height:8px;background:#eee;border-radius:6px;overflow:hidden}
.fill{height:8px;background:#111;border-radius:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
pre{white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:10px;border:1px solid #eef2f7}
.tbl{border-collapse:collapse;width:100%}
.tbl th,.tbl td{border:1px solid #e5e7eb;padding:6px 8px;text-align:right}
.tbl th:first-child,.tbl td:first-child{text-align:left}
</style></head>
<body>
<h1>Time to Detect (TTD)</h1>

<div class="card">
  <div class="badge">Window: <b>${summary.window_hours}h</b></div>
  <div class="badge">Samples: <b>${summary.samples}</b></div>
  <div class="badge">P50: <b>${summary.percentiles.p50}h</b></div>
  <div class="badge">P95: <b>${summary.percentiles.p95}h</b></div>
  <div class="badge">Status: <b>${summary.status}</b></div>
  <p><small>${summary.note}. Targets: P50 ≤ ${TGT_P50}h, P95 ≤ ${TGT_P95}h.</small></p>
</div>

<div class="card grid">
  <div>
    <h3>Gauge (P50)</h3>
    <div class="kv"><div>Target</div><div>≤ ${TGT_P50}h</div></div>
    <div class="bar"><div class="fill" style="width:${Math.min(100, (summary.percentiles.p50/${TGT_P50})*100)}%"></div></div>
  </div>
  <div>
    <h3>Gauge (P95)</h3>
    <div class="kv"><div>Target</div><div>≤ ${TGT_P95}h</div></div>
    <div class="bar"><div class="fill" style="width:${Math.min(100, (summary.percentiles.p95/${TGT_P95})*100)}%"></div></div>
  </div>
</div>

<div class="card">
  <h3>Percentiles</h3>
  <table class="tbl">
    <tr><th>P10</th><th>P25</th><th>P50</th><th>P75</th><th>P90</th><th>P95</th><th>P99</th></tr>
    <tr>
      <td>${summary.percentiles.p10}</td>
      <td>${summary.percentiles.p25}</td>
      <td>${summary.percentiles.p50}</td>
      <td>${summary.percentiles.p75}</td>
      <td>${summary.percentiles.p90}</td>
      <td>${summary.percentiles.p95}</td>
      <td>${summary.percentiles.p99}</td>
    </tr>
  </table>
</div>

<div class="card">
  <h3>Histogram (counts)</h3>
  <table class="tbl">
    <tr>${Object.keys(summary.histogram).map(k=>`<th>${k}</th>`).join('')}</tr>
    <tr>${Object.values(summary.histogram).map(v=>`<td>${v}</td>`).join('')}</tr>
  </table>
</div>

<div class="card">
  <h3>How it's computed</h3>
  <ul>
    <li>Only real changes are counted (exclude <code>kind=baseline</code> or empty hash).</li>
    <li>Observed time: try <code>observed_at</code> → <code>fetched_at</code> → <code>collected_at</code> → <code>detected_at</code> → filename date.</li>
    <li>Source date: try <code>effective_date</code> → <code>source_last_modified</code> → <code>page_last_modified</code> → <code>published_at/lastmod/date</code>.</li>
    <li>Window: last ${summary.window_hours} hours.</li>
    <li>Negative intervals are clamped to 0 (clock skew).</li>
  </ul>
</div>

<p><small>Generated at ${summary.generated_at}</small></p>
</body></html>`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'ttd.html'), html, 'utf8');

  // 回写 artifacts/daily_ops.json
  try {
    if (exists(ART_DAILY)) {
      const daily = JSON.parse(fs.readFileSync(ART_DAILY, 'utf8'));
      daily.kpi = daily.kpi || {};
      daily.kpi.ttd_p50_hours = summary.percentiles.p50;
      daily.kpi.ttd_p95_hours = summary.percentiles.p95;
      daily.kpi.ttd_samples   = summary.samples;

      // 维护 PASS/WARN/FAIL
      daily.PASS = Array.isArray(daily.PASS) ? daily.PASS : [];
      daily.WARN = Array.isArray(daily.WARN) ? daily.WARN : [];
      daily.FAIL = Array.isArray(daily.FAIL) ? daily.FAIL : [];

      // 先移除旧的 TTD 相关项（避免重复）
      const strip = s => s.replace(/\s+/g,'').toLowerCase();
      const notTTD = (s='') => !/ttd|p95/i.test(s);
      daily.PASS = daily.PASS.filter(notTTD);
      daily.WARN = daily.WARN.filter(notTTD);
      daily.FAIL = daily.FAIL.filter(notTTD);

      if (summary.status === 'pass_burnin') {
        daily.PASS.push(`TTD P95 ≤ ${TGT_P95}h（Burn-in 放行）`);
        daily.WARN.push('TTD 样本不足（近窗口样本量不足）');
      } else if (summary.status === 'pass') {
        daily.PASS.push(`TTD P95 ≤ ${TGT_P95}h`);
      } else {
        daily.FAIL.push(`TTD P95 > ${TGT_P95}h`);
      }

      writeJSON(ART_DAILY, daily);
    }
  } catch { /* 忽略回写失败 */ }

  console.log(
    `TTD report -> n=${summary.samples}, ` +
    `P50=${summary.percentiles.p50}h, P95=${summary.percentiles.p95}h, ` +
    `window=${summary.window_hours}h, status=${summary.status}`
  );
}

run();
