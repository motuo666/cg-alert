#!/usr/bin/env node
/**
 * build_public_monthly.js  — CG Alert 月报公开页（专业版）
 * 产出（全部幂等）：
 *   - reports/<YYYY-MM>/index.html   月报页（含 KPI/分布/表格/方法论）
 *   - reports/<YYYY-MM>/changes.csv  当月变更 CSV（date,vendor,type,url）
 *   - reports/index.html             索引页（最近月份 + 列表）
 *   - reports/rss.xml                最近 12 个月 RSS
 *
 * 规则：
 *   - evidence/<vendor>/<YYYY-MM-DD>.json 作为“证据”来源
 *   - 变更类型：pricing / tos / dpa / subprocessors / status / other
 *   - 没有证据也照常生成空月报（避免 404/空目录）
 *
 * 不触碰：站点配色/全站结构/主题；仅在本页内联极少量样式。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://www.cg-alert.com';

const TYPE_KEYS = [
  { key: 'pricing',       pat: /(pricing|price|plan)/i },
  { key: 'tos',           pat: /\b(tos|terms of service|terms)\b/i },
  { key: 'dpa',           pat: /\bdpa\b|data processing/i },
  { key: 'subprocessors', pat: /sub-?processors?/i },
  { key: 'status',        pat: /status|incident|uptime/i },
];

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function ymd(d){ return d.toISOString().slice(0,10); }
function ymOfDate(d){ return d.toISOString().slice(0,7); }
function readJSON(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function htmlEscape(s){
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function detectType(obj, fname=''){
  const blob = (JSON.stringify(obj||{}) + ' ' + fname).toLowerCase();
  for (const t of TYPE_KEYS) if (t.pat.test(blob)) return t.key;
  return 'other';
}

function firstUrlFromObject(obj){
  // 在对象内寻找第一个 http(s) 链接，用作证据链接；找不到就返回空
  try {
    const stack = [obj];
    while (stack.length) {
      const v = stack.pop();
      if (typeof v === 'string') {
        const m = v.match(/https?:\/\/[^\s"'<>]+/i);
        if (m) return m[0];
      } else if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) stack.push(v[k]);
      }
    }
  } catch {}
  return '';
}

function listAllEvidence() {
  const base = path.join(ROOT, 'evidence');
  const out = [];
  if (!fs.existsSync(base)) return out;
  for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const slug = ent.name;
    const dir = path.join(base, slug);
    for (const f of fs.readdirSync(dir)) {
      if (!/\.json$/i.test(f)) continue;
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      const obj = readJSON(p) || {};
      const type = detectType(obj, f);
      const evidenceUrl = firstUrlFromObject(obj);
      out.push({
        slug,
        file: p,
        when: st.mtime,             // Date
        type,                       // one of types
        evidenceUrl,                // may be ''
        vendorUrl: `${SITE}/vendors/${encodeURIComponent(slug)}/`,
      });
    }
  }
  // 新到旧
  return out.sort((a,b)=> b.when - a.when);
}

function bucketByMonth(items){
  const m = new Map(); // ym -> items[]
  for (const it of items) {
    const ym = ymOfDate(it.when);
    if (!m.has(ym)) m.set(ym, []);
    m.get(ym).push(it);
  }
  return m;
}

function buildCSV(items, outCsv){
  const lines = [['date','vendor','type','url'].join(',')];
  for (const it of items) {
    const url = it.evidenceUrl || it.vendorUrl;
    lines.push([ymd(it.when), it.slug, it.type, url].join(','));
  }
  fs.writeFileSync(outCsv, lines.join('\n'));
}

function kpiCounts(items){
  const byType = { pricing:0, tos:0, dpa:0, subprocessors:0, status:0, other:0 };
  const vendors = new Set();
  let latest = 0;
  for (const it of items) {
    vendors.add(it.slug);
    byType[it.type] = (byType[it.type] || 0) + 1;
    const ts = it.when.getTime();
    if (ts > latest) latest = ts;
  }
  return {
    total: items.length,
    vendors: vendors.size,
    byType,
    latestISO: latest ? new Date(latest).toISOString() : new Date().toISOString(),
  };
}

function headForMonth(ym, kpi){
  const title = `Public Changes — ${ym} · CG Alert`;
  const desc  = `Evidence-backed public changes (${ym}): ${kpi.total} changes across ${kpi.vendors} vendors.`;
  const canon = `${SITE}/reports/${ym}/`;
  const ld = {
    "@context":"https://schema.org",
    "@type":"Report",
    "name": title,
    "datePublished": `${ym}-01`,
    "url": canon,
    "inLanguage":"en",
    "about":["Pricing","ToS","DPA","Subprocessors","Status"],
    "publisher":{"@type":"Organization","name":"CG Alert","url":SITE}
  };
  return `
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${canon}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="article">
<meta property="og:url" content="${canon}">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${JSON.stringify(ld)}</script>`.trim();
}

function renderTypeBadge(t, n){
  const label = {pricing:'Pricing', tos:'ToS', dpa:'DPA', subprocessors:'Subprocessors', status:'Status', other:'Other'}[t] || t;
  return `<div class="kpi"><div class="n">${n}</div><div class="t">${label}</div></div>`;
}

function pageCSS(){
  return `
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;color:#111;background:#fff}
.wrap{max-width:1080px;margin:0 auto;padding:32px 16px}
h1{font-size:28px;margin:8px 0 12px}
h2{font-size:18px;margin:24px 0 10px}
p{line-height:1.65}
.header{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.meta{color:#666;font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(6, minmax(110px,1fr));gap:10px;margin:18px 0}
.kpi{border:1px solid #eee;border-radius:12px;padding:10px;text-align:center}
.kpi .n{font-size:20px;font-weight:600}
.kpi .t{font-size:12px;color:#555}
.actions{display:flex;gap:10px;flex-wrap:wrap}
.btn{display:inline-block;padding:10px 14px;border:1px solid #222;border-radius:10px;color:#111;text-decoration:none}
.btn:hover{background:#111;color:#fff}
table{width:100%;border-collapse:collapse;margin-top:10px}
th,td{padding:10px;border-bottom:1px solid #eee;text-align:left;font-size:14px}
.badge{display:inline-block;border:1px solid #ddd;border-radius:999px;padding:2px 8px;margin-right:6px;font-size:12px}
.section{margin-top:28px}
.footer{margin-top:28px;color:#666;font-size:12px}
ul{padding-left:18px}
.breadcrumb{font-size:13px;margin-bottom:12px;color:#666}
.breadcrumb a{color:#666}
`.trim();
}

function renderMonthHTML(ym, items){
  const kpi = kpiCounts(items);

  // vendor 维度聚合
  const byVendor = new Map();
  for (const it of items) {
    if (!byVendor.has(it.slug)) byVendor.set(it.slug, { slug: it.slug, types:new Set(), latest: it.when, anyUrl: it.evidenceUrl || it.vendorUrl });
    const v = byVendor.get(it.slug);
    v.types.add(it.type);
    if (it.when > v.latest) v.latest = it.when;
    if (!v.anyUrl) v.anyUrl = it.evidenceUrl || it.vendorUrl;
  }
  const rows = [...byVendor.values()]
    .sort((a,b)=> b.latest - a.latest)
    .map(v=>{
      const badges = [...v.types].map(t=>`<span class="badge">${t}</span>`).join(' ');
      const url = v.anyUrl || `${SITE}/vendors/${encodeURIComponent(v.slug)}/`;
      return `<tr>
        <td><a href="/vendors/${encodeURIComponent(v.slug)}/">${htmlEscape(v.slug)}</a></td>
        <td>${badges || '-'}</td>
        <td>${ymd(v.latest)}</td>
        <td><a href="${url}">Evidence</a></td>
      </tr>`;
    }).join('\n');

  const head = headForMonth(ym, kpi);
  const kpiBar = [
    renderTypeBadge('pricing', kpi.byType.pricing || 0),
    renderTypeBadge('tos', kpi.byType.tos || 0),
    renderTypeBadge('dpa', kpi.byType.dpa || 0),
    renderTypeBadge('subprocessors', kpi.byType.subprocessors || 0),
    renderTypeBadge('status', kpi.byType.status || 0),
    renderTypeBadge('other', kpi.byType.other || 0),
  ].join('\n');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${head}
<style>${pageCSS()}</style>
</head>
<body>
<div class="wrap">
  <div class="breadcrumb"><a href="/reports/">Reports</a> / ${ym}</div>
  <div class="header">
    <div>
      <h1>Public Changes — ${ym}</h1>
      <div class="meta">${kpi.total} changes · ${kpi.vendors} vendors · last updated ${kpi.latestISO.replace('T',' ').slice(0,16)}Z</div>
    </div>
    <div class="actions">
      <a class="btn" href="/reports/${ym}/changes.csv">Download CSV</a>
      <a class="btn" href="/reports/rss.xml" rel="alternate">RSS</a>
    </div>
  </div>

  <div class="kpis">${kpiBar}</div>

  <div class="section">
    <h2>Vendors impacted</h2>
    <table>
      <thead><tr><th>Vendor</th><th>Types</th><th>Last change</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No changes recorded this month.</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Methodology & Verification</h2>
    <ul>
      <li>Sources: public vendor pages (Pricing / ToS / DPA / Subprocessors / Status).</li>
      <li>Robots: robots.txt respected; sitemap &amp; security.txt observed.</li>
      <li>Noise reduction: two-stage confirmation; evidence link included where available.</li>
      <li>Opt-out: vendors may request exclusion within 72h.</li>
    </ul>
  </div>

  <div class="footer">© ${new Date().getFullYear()} CG Alert · Evidence-backed vendor change alerts.</div>
</div>
</body></html>`;
}

function renderIndexHTML(latestYM, months, buckets){
  const head = `
<title>Reports — CG Alert</title>
<meta name="description" content="Monthly evidence-backed public changes.">
<link rel="canonical" href="${SITE}/reports/">
<link rel="alternate" type="application/rss+xml" title="CG Alert Reports RSS" href="${SITE}/reports/rss.xml">`.trim();

  const lis = months.map(m=>{
    const count = (buckets.get(m)||[]).length;
    return `<li><a href="/reports/${m}/">${m}</a> — ${count} changes</li>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${head}
<style>
${pageCSS()}
.wrap{max-width:820px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Reports</h1>
  <p>Latest: <a href="/reports/${latestYM}/">${latestYM}</a> · <a class="btn" href="/reports/rss.xml">RSS</a></p>
  <ul>${lis}</ul>
  <div class="section">
    <h2>What’s included</h2>
    <p>Evidence-backed changes on vendors’ public pages (Pricing / ToS / DPA / Subprocessors / Status). Generated automatically on the 1st of each month.</p>
  </div>
</div>
</body></html>`;
}

function renderRSS(months, buckets){
  const lastBuild = new Date().toUTCString();
  const items = months.slice(0,12).map(m=>{
    const count = (buckets.get(m)||[]).length;
    return `
<item>
  <title>${m} — ${count} changes</title>
  <link>${SITE}/reports/${m}/</link>
  <guid>${SITE}/reports/${m}/</guid>
  <pubDate>${new Date(`${m}-01`).toUTCString()}</pubDate>
  <description>${count} evidence-backed changes</description>
</item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>CG Alert — Monthly Reports</title>
<link>${SITE}/reports/</link>
<description>Evidence-backed changes on vendors’ public pages</description>
<lastBuildDate>${lastBuild}</lastBuildDate>
${items}
</channel></rss>`;
}

(function main(){
  const arg = (process.argv.find(x=>x.startsWith('--month='))||'').split('=')[1] || '';
  const all = listAllEvidence();
  const byMonth = bucketByMonth(all);

  const months = [...byMonth.keys()].sort().reverse();
  const targetYM = arg || (months[0] || new Date().toISOString().slice(0,7));
  const monthItems = byMonth.get(targetYM) || [];

  // 输出目录 & 文件
  const outDir = path.join(ROOT, 'reports', targetYM);
  ensureDir(outDir);

  // 当月 CSV
  buildCSV(monthItems, path.join(outDir, 'changes.csv'));

  // 当月 HTML
  fs.writeFileSync(path.join(outDir, 'index.html'), renderMonthHTML(targetYM, monthItems));

  // 索引页 + RSS（取最近 12 个月；没有证据也要有当前月链接）
  const indexMonths = months.length ? months : [targetYM];
  const idxDir = path.join(ROOT, 'reports');
  ensureDir(idxDir);
  fs.writeFileSync(path.join(idxDir, 'index.html'), renderIndexHTML(targetYM, indexMonths, byMonth));
  fs.writeFileSync(path.join(idxDir, 'rss.xml'), renderRSS(indexMonths, byMonth));

  console.log(`[reports] built for ${targetYM} (items=${monthItems.length})`);
})();
