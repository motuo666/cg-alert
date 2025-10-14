#!/usr/bin/env node
/**
 * 读取 data/evidence.ndx → 为最近90天活跃 vendor 生成 Change Pack
 * 输出：/reports/<YYYY-MM>/<vendor>/index.html（What/So/Now + 可核证证据表）
 * 纯静态，无外部依赖
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NDX  = path.join(ROOT, 'data', 'evidence.ndx');
const REPORT_ROOT = path.join(ROOT, 'reports');

const NOW = new Date();
const Y = NOW.getUTCFullYear();
const M = String(NOW.getUTCMonth() + 1).padStart(2, '0');
const CUR = `${Y}-${M}`;

function readNDX() {
  if (!fs.existsSync(NDX)) return [];
  return fs
    .readFileSync(NDX, 'utf8')
    .split(/\n+/)
    .filter(Boolean)
    .map(l => {
      // date \t slug \t type \t hash \t path
      const [date, slug, type, hash, rel] = l.split('\t');
      return { date, slug, type, hash, rel };
    });
}

function daysSince(dateStr) {
  const ms = NOW - new Date(dateStr + 'T00:00:00Z');
  return Math.floor(ms / 86400000);
}

function pickTopic(type) {
  const map = {
    Pricing: 'Pricing',
    ToS: 'Terms of Service',
    DPA: 'DPA',
    Subprocessors: 'Subprocessors',
    Status: 'Status'
  };
  return map[type] || String(type || 'Change');
}

function changeImpact(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'pricing') return 'Budget/renewal risk';
  if (t === 'tos' || t.includes('term')) return 'Legal/arbitration/termination';
  if (t === 'dpa' || t.includes('privacy')) return 'Privacy/data processing';
  if (t.includes('subprocessor')) return 'Vendor risk/DP addendum';
  if (t === 'status' || t.includes('sla') || t.includes('incident'))
    return 'SLA/incident history';
  return 'Contract/Compliance';
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderPack(vendor, records) {
  // What：按类别聚合；So：影响类别；Now：建议动作
  const buckets = {};
  for (const r of records) {
    (buckets[r.type] = buckets[r.type] || []).push(r);
  }
  const what = Object.entries(buckets)
    .map(([k, arr]) => `<li><b>${escapeHtml(pickTopic(k))}</b>: ${arr.length} change(s) in last 90 days</li>`)
    .join('');

  const so = Object.keys(buckets)
    .map(k => changeImpact(k))
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' · ');

  const nowBullets = [
    'Lock pricing / request grandfathering at renewal',
    'Review arbitration/termination with Legal',
    'Update internal register & notify stakeholders if material'
  ];

  const rows = records.slice(0, 200).map(r => {
    const link = '/' + String(r.rel || '').replace(/\\/g, '/');
    const hash8 = String(r.hash || '').slice(0, 8);
    return `<tr><td>${escapeHtml(r.date || '')}</td><td>${escapeHtml(pickTopic(r.type))}</td><td><code>${hash8}</code></td><td><a href="${escapeHtml(link)}">evidence</a></td></tr>`;
  }).join('');

  // 准备 JSON-LD 字符串，避免在模板字符串里嵌套模板字符串导致语法错误
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Report',
    name: `${vendor} Change Pack ${CUR}`,
    datePublished: new Date().toISOString(),
    about: vendor
  };
  const ldJson = JSON.stringify(ld);

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(vendor)} Change Pack (${CUR})</title>
<meta name="description" content="Verifiable public changes for ${escapeHtml(vendor)} in ${CUR}">
<link rel="canonical" href="/reports/${CUR}/${escapeHtml(vendor)}/">
<script type="application/ld+json">${ldJson}</script>
<style>
  body{font-family:system-ui,Segoe UI,Arial;line-height:1.55;padding:24px;max-width:920px;margin:auto}
  table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}
  code{background:#f5f5f5;padding:2px 4px;border-radius:4px}
  h1{margin:0 0 8px} h3{margin:20px 0 8px}
</style>
</head>
<body>
<h1>${escapeHtml(vendor)} — Change Pack (${CUR})</h1>
<h3>What</h3><ul>${what || '<li>No public changes in last 90 days</li>'}</ul>
<h3>So What</h3><p>${so || 'No material impact detected'}</p>
<h3>Now What</h3><ul>${nowBullets.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
<h3>Verifiable evidence</h3>
<table><thead><tr><th>Date</th><th>Type</th><th>Hash</th><th>Link</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No evidence available</td></tr>'}</tbody></table>
<p><small>All evidence derived from public pages with timestamp+hash. Respect robots/sitemap/security.txt.</small></p>
</body>
</html>`;
  return html;
}

(function main() {
  const ndx = readNDX().filter(r => daysSince(r.date) <= 90);
  if (!ndx.length) {
    console.log('no recent evidence; skip change pack build');
    return;
  }
  // 按 vendor 汇总
  const byVendor = new Map();
  for (const r of ndx) {
    const arr = byVendor.get(r.slug) || [];
    arr.push(r);
    byVendor.set(r.slug, arr);
  }
  // 选前 50 个活跃度最高的 vendor
  const top = [...byVendor.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 50);

  const base = path.join(REPORT_ROOT, CUR);
  ensureDir(base);

  for (const [vendor, arr] of top) {
    const outDir = path.join(base, vendor);
    ensureDir(outDir);
    const html = renderPack(vendor, arr.sort((a, b) => a.date.localeCompare(b.date)));
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    console.log('pack:', vendor, arr.length);
  }
})();
