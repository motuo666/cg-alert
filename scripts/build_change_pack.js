#!/usr/bin/env node
/**
 * 读取 data/evidence.ndx → 生成 Change Pack
 * 输出：/reports/<YYYY-MM>/<vendor>/index.html
 * 增强：首屏徽章 + CTA（Enable alerts / Buy Portfolio / Home），未配置则自动隐藏
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

// 外部可配（不配就隐藏相关按钮）
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const INTAKE_FORM_URL = process.env.INTAKE_FORM_URL || '';              // 你的 Google Form 链接
const STRIPE_LINK_PORTFOLIO = process.env.STRIPE_LINK_PORTFOLIO || '';  // 你的 Stripe Payment Link

function readNDX() {
  if (!fs.existsSync(NDX)) return [];
  return fs.readFileSync(NDX, 'utf8').split(/\n+/).filter(Boolean).map(l => {
    const [date, slug, type, hash, rel] = l.split('\t');
    return { date, slug, type, hash, rel };
  });
}
function daysSince(dateStr) {
  const ms = NOW - new Date(dateStr + 'T00:00:00Z');
  return Math.floor(ms / 86400000);
}
function pickTopic(type) {
  const map = { Pricing:'Pricing', ToS:'Terms of Service', DPA:'DPA', Subprocessors:'Subprocessors', Status:'Status' };
  return map[type] || String(type || 'Change');
}
function changeImpact(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'pricing') return 'Budget/renewal risk';
  if (t === 'tos' || t.includes('term')) return 'Legal/arbitration/termination';
  if (t === 'dpa' || t.includes('privacy')) return 'Privacy/processing terms';
  if (t.includes('subprocessor')) return 'Vendor risk/DP addendum';
  if (t === 'status' || t.includes('sla') || t.includes('incident')) return 'SLA/incident history';
  return 'Contract/Compliance';
}
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function isZeroHash(h) { return !h || /^0+$/i.test(String(h)); }

function renderPack(vendor, records) {
  // What/So/Now
  const buckets = {};
  for (const r of records) (buckets[r.type] = buckets[r.type] || []).push(r);

  const what = Object.entries(buckets)
    .map(([k, arr]) => `<li><b>${escapeHtml(pickTopic(k))}</b>: ${arr.length} change(s) in last 90 days</li>`)
    .join('');

  const so = Object.keys(buckets).map(k => changeImpact(k))
    .filter((v, i, a) => a.indexOf(v) === i).join(' · ');

  const nowBullets = [
    'Lock pricing / request grandfathering at renewal',
    'Review arbitration/termination with Legal',
    'Update internal register & notify stakeholders if material'
  ];

  // 证据表
  const rows = records.slice(0, 200).map(r => {
    const link = '/' + String(r.rel || '').replace(/\\/g, '/');
    const h = String(r.hash || '').toLowerCase();
    const display = isZeroHash(h) ? '&mdash;' : `<code>${h.slice(0,8)}</code>`;
    return `<tr><td>${escapeHtml(r.date || '')}</td><td>${escapeHtml(pickTopic(r.type))}</td><td>${display}</td><td><a href="${escapeHtml(link)}">evidence</a></td></tr>`;
  }).join('');

  // 徽章
  const lastDate = records.map(r=>r.date).sort().slice(-1)[0] || '';
  const total = records.length;
  const impactSet = Object.keys(buckets).map(k => changeImpact(k)).filter((v,i,a)=>a.indexOf(v)===i);
  const badges = `
<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 16px">
  <span style="background:#eef;padding:4px 8px;border-radius:8px">Last change: ${escapeHtml(lastDate||'n/a')}</span>
  <span style="background:#efe;padding:4px 8px;border-radius:8px">Evidence: ${total}</span>
  <span style="background:#fee;padding:4px 8px;border-radius:8px">${escapeHtml(impactSet.join(' · ')||'No material impact')}</span>
</div>`.trim();

  // CTA（未配置的自动隐藏）
  const vParam = encodeURIComponent(vendor);
  const utm = `utm_source=email&utm_medium=triggered&utm_campaign=cp_${CUR}`;
  const ctaEnable = INTAKE_FORM_URL
    ? `<a class="btn primary" href="${escapeHtml(INTAKE_FORM_URL)}?vendor=${vParam}&${utm}">Enable alerts for ${escapeHtml(vendor)}</a>` : '';
  const ctaBuy = STRIPE_LINK_PORTFOLIO
    ? `<a class="btn" href="${escapeHtml(STRIPE_LINK_PORTFOLIO)}?${utm}">Buy Portfolio $2,988/yr</a>` : '';
  const ctaHome = `<a class="btn ghost" href="${ORIGIN}/">Home</a>`;
  const ctas = `
<div class="cta">
  ${ctaEnable}${ctaBuy}${ctaHome}
</div>`.trim();

  // JSON-LD
  const ld = { '@context':'https://schema.org','@type':'Report',
    name: `${vendor} Change Pack ${CUR}`, datePublished: new Date().toISOString(), about: vendor };
  const ldJson = JSON.stringify(ld);

  // HTML
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
  .cta{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-start;margin:4px 0 16px}
  .btn{display:inline-block;padding:8px 12px;border-radius:8px;border:1px solid #ddd;text-decoration:none}
  .btn.primary{background:#111;color:#fff;border-color:#111}
  .btn.ghost{background:transparent}
  table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}
  code{background:#f5f5f5;padding:2px 4px;border-radius:4px}
  h1{margin:0 0 8px} h3{margin:20px 0 8px}
</style>
</head>
<body>
<h1>${escapeHtml(vendor)} — Change Pack (${CUR})</h1>
${badges}
${ctas}
<h3>What</h3><ul>${what || '<li>No public changes in last 90 days</li>'}</ul>
<h3>So What</h3><p>${so || 'No material impact detected'}</p>
<h3>Now What</h3><ul>${nowBullets.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
<h3>Verifiable evidence</h3>
<table><thead><tr><th>Date</th><th>Type</th><th>Hash</th><th>Link</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No evidence available</td></tr>'}</tbody></table>
<p><small>All evidence from public pages; respect robots/sitemap/security.txt. Refund policy and terms as published on site.</small></p>
</body>
</html>`;
  return html;
}

(function main(){
  const lines = readNDX().filter(r => daysSince(r.date) <= 90);
  if (!lines.length) { console.log('no recent evidence; skip'); return; }

  const byVendor = new Map();
  for (const r of lines) { const arr = byVendor.get(r.slug) || []; arr.push(r); byVendor.set(r.slug, arr); }

  const top = [...byVendor.entries()].sort((a,b)=>b[1].length - a[1].length).slice(0,50);
  const base = path.join(REPORT_ROOT, CUR);
  ensureDir(base);

  for (const [vendor, arr] of top) {
    const outDir = path.join(base, vendor);
    ensureDir(outDir);
    const html = renderPack(vendor, arr.sort((a,b)=>a.date.localeCompare(b.date)));
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    console.log('pack:', vendor, arr.length);
  }
})();
