#!/usr/bin/env node
/**
 * 生成每日可视化报告：
 *   - /reports/ops/<YYYY-MM-DD>/index.html
 *   - /reports/ops/index.html（最近10天索引）
 *
 * 数据来源：
 *   - artifacts/daily_ops.json   （fullchain_check.js 产物，含 KPI / PASS / WARN / FAIL）
 *   - reports/ops/ttd.json       （可选，build_ttd_report.js 产物，含 TTD P50/P95）
 *
 * 说明：
 *   - 仅使用仓库内数据；Open/Click/Unsub/Spam 需在 SMTP 后台查看。
 *   - 脚本可在本地或 Actions Runner 上运行。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTBASE = path.join(ROOT, 'reports', 'ops');
const ART = path.join(ROOT, 'artifacts', 'daily_ops.json');
const TTD_JSON = path.join(OUTBASE, 'ttd.json');

function readJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return null; }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function escapeHtml(s='') {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function pct(v, max) {
  if (!max || max <= 0) return 0;
  const p = Math.round(100 * (v / max));
  return Math.max(0, Math.min(100, p));
}

function badge(label, value) {
  return `<div class="badge">${escapeHtml(label)}: <b>${escapeHtml(String(value))}</b></div>`;
}

function bar(current, target, label) {
  const width = pct(current || 0, target || 0);
  return `<div class="bar"><div class="bar-label">${escapeHtml(label)}: <b>${current||0}</b> / ${target||'-'}</div><div class="bar-rail"><div class="bar-fill" style="width:${width}%"></div></div></div>`;
}

function listBlock(title, arr, cls) {
  if (!arr || !arr.length) return '';
  const items = arr.map(x => `<li>${escapeHtml(String(x))}</li>`).join('');
  return `<div class="card ${cls||''}">
    <h3>${escapeHtml(title)} <small>(${arr.length})</small></h3>
    <ul class="list">${items}</ul>
  </div>`;
}

function renderPage(data, ttd) {
  const { date, kpi = {}, PASS = [], WARN = [], FAIL = [] } = data || {};
  const hashRatioPct = ((kpi.hash_ratio || 0) * 100).toFixed(1);

  // 可选 TTD
  const ttdP50 = ttd && typeof ttd.p50_hours === 'number' ? ttd.p50_hours : null;
  const ttdP95 = ttd && typeof ttd.p95_hours === 'number' ? ttd.p95_hours : null;

  const targetEvidence = Number(process.env.TARGET_EVID_TODAY || 10);
  const targetSent     = Number(process.env.TARGET_SENT || 16);
  const targetHashPct  = Number(process.env.TARGET_HASH_PCT || 40);

  const styles = `
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;max-width:980px;margin:auto;line-height:1.6;background:#fff;color:#111}
  h1{margin:0 0 12px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:10px 0;box-shadow:0 1px 2px rgba(0,0,0,.03);background:#fff}
  .badges{display:flex;flex-wrap:wrap;gap:8px}
  .badge{display:inline-block;background:#f3f4f6;border-radius:999px;padding:4px 10px}
  .kv{display:flex;justify-content:space-between;border-bottom:1px dashed #eee;padding:6px 0}
  .bar{margin:8px 0}
  .bar-rail{height:8px;background:#eee;border-radius:6px}
  .bar-fill{height:8px;background:#222;border-radius:6px}
  .muted{color:#6b7280}
  .list{padding-left:18px;margin:6px 0}
  .ok{color:#065f46}
  .warn{color:#92400e}
  .fail{color:#991b1b}
  .footer{margin-top:20px;color:#6b7280;font-size:12px}
  a{color:#111}
  `;

  const ttdBlock = (ttdP50!=null || ttdP95!=null) ? `
    <div class="kv"><div>TTD P50 (hours)</div><div><b>${ttdP50!=null ? ttdP50 : '-'}</b></div></div>
    <div class="kv"><div>TTD P95 (hours)</div><div><b>${ttdP95!=null ? ttdP95 : '-'}</b></div></div>
  ` : `<div class="kv"><div>TTD</div><div class="muted">no data</div></div>`;

  const hashBar = bar(Number((kpi.hash_ratio||0)*100).toFixed(1), targetHashPct, 'Hash coverage (%)');

  return `<!doctype html><html><head><meta charset="utf-8">
<title>Daily Ops - ${escapeHtml(date||'')}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${styles}</style></head>
<body>
  <h1>Daily Ops — ${escapeHtml(date||'')}</h1>

  <div class="card">
    <div class="badges">
      ${badge('Evidence today', kpi.evidence_today||0)}
      ${badge('Packs this month', kpi.packs_month||0)}
      ${badge('Changed vendors (72h)', kpi.changed_vendors_72h||0)}
      ${badge('Sent today', kpi.sent_today||0)}
      ${badge('Hash coverage', `${hashRatioPct}%`)}
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>Progress</h3>
      ${bar(kpi.evidence_today||0, targetEvidence, \`Evidence vs target(${targetEvidence})\`)}
      ${bar(kpi.sent_today||0, targetSent, \`Sent vs target(${targetSent})\`)}
      ${hashBar}
    </div>
    <div class="card">
      <h3>Metrics</h3>
      <div class="kv"><div>Evidence total</div><div>${kpi.evidence_total||0}</div></div>
      <div class="kv"><div>Dry today</div><div>${kpi.dry_today||0}</div></div>
      ${ttdBlock}
      <div class="kv"><div>Reports index</div><div><a href="../">ops index</a></div></div>
    </div>
  </div>

  ${listBlock('Warnings', WARN, 'warn')}
  ${listBlock('Failures (blocking)', FAIL, 'fail')}

  <div class="card">
    <h3>What to do next</h3>
    <ul class="list">
      <li>若 <b>Evidence today</b> = 0：手动跑 Public Change Poller；仍 0 → 明天扩大窗口</li>
      <li>若 <b>Sent today</b> &lt; ${targetSent>8?targetSent:8}：Outreach Triggered 再跑一次，<code>window_h=168</code></li>
      <li>日终在 SMTP 后台看 Open/Click；退订 ≤ 0.5%，投诉 ≤ 0.1%</li>
    </ul>
    <p class="muted">Open/Click/Unsub/Spam 由 SMTP 控制台提供，本页不展示。</p>
  </div>

  <div class="footer">Generated from <code>artifacts/daily_ops.json</code>${ttd ? ' & <code>reports/ops/ttd.json</code>' : ''}</div>
</body></html>`;
}

(function main(){
  const data = readJSON(ART);
  if (!data) {
    console.error('missing artifacts/daily_ops.json, run fullchain_check first');
    process.exit(1);
  }
  const ttd = readJSON(TTD_JSON);

  ensureDir(OUTBASE);

  const date = data.date || new Date().toISOString().slice(0,10);
  const dir = path.join(OUTBASE, date);
  ensureDir(dir);

  // 写入当日页
  const html = renderPage(data, ttd);
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');

  // 更新索引页（最近10天）
  const days = fs.readdirSync(OUTBASE, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map(d => d.name).sort().slice(-10).reverse();

  const links = days.map(d => `<li><a href="./${d}/">${d}</a></li>`).join('');
  const idx = `<!doctype html><html><head><meta charset="utf-8"><title>Daily Ops</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;max-width:700px;margin:auto} li{margin:6px 0}</style></head>
  <body><h1>Daily Ops</h1><ol>${links}</ol>${
    fs.existsSync(TTD_JSON) ? `<p><a href="./ttd.html">TTD Report</a></p>` : ''
  }</body></html>`;
  fs.writeFileSync(path.join(OUTBASE, 'index.html'), idx, 'utf8');

  console.log(`daily ops report -> reports/ops/${date}/index.html`);
})();
