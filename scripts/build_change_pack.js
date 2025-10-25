#!/usr/bin/env node
/**
 * 从 data/evidence.ndx 生成 Change Pack（/reports/<YYYY-MM>/<vendor>/index.html）
 * —— no-snapshot + 统一主题版 ——
 *
 * 要求：
 * - 不渲染 Proof/snapshot/run_url/github/actions 等任何外链
 * - 表格只保留 5 列：Date / Type / Hash / Link / Excerpt
 * - “No evidence” 行 colspan="5"
 * - 页面本身不输出 <header>，后续由 theme_injector.js 注入统一站点导航
 * - 引入站点 /styles.css 与 /assets/cg-theme.css，背景强制白底，避免右边整块黑
 * - CTA / SEO / Schema 保留
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NDX  = path.join(ROOT, 'data', 'evidence.ndx');
const REPORT_ROOT = path.join(ROOT, 'reports');
const MATERIALITY_CSV = path.join(ROOT, 'data', 'materiality.csv');

const NOW = new Date();
const Y = NOW.getUTCFullYear();
const M = String(NOW.getUTCMonth() + 1).padStart(2, '0');
const CUR = `${Y}-${M}`;

// 对外域名（仅用于 CTA），不影响证据链接
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const INTAKE_FORM_URL = process.env.INTAKE_FORM_URL || '';
const STRIPE_LINK_PORTFOLIO = process.env.STRIPE_LINK_PORTFOLIO || '';

// ---------- 小工具 ----------
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function escapeHtml(s) {
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function isZeroHash(h) { return !h || /^0+$/i.test(String(h)); }
function daysSince(dateStr) {
  const ms = NOW - new Date(dateStr + 'T00:00:00Z');
  return Math.floor(ms / 86400000);
}
function readLines(fp){
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp,'utf8').split(/\r?\n/).filter(Boolean);
}
function slugify(s){
  return String(s||'')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9.-]+/g,'-')
    .replace(/^-+|-+$/g,'');
}
function joinWithUTM(url, extraParams){
  const join = url.includes('?') ? '&' : '?';
  const utm = `utm_source=site&utm_medium=internal&utm_campaign=cp_${CUR}`;
  return url + join + (extraParams ? `${extraParams}&` : '') + utm;
}

// ---------- 业务映射 ----------
function pickTopic(type) {
  const map = {
    Pricing:'Pricing',
    ToS:'Terms of Service',
    DPA:'DPA',
    Subprocessors:'Subprocessors',
    Status:'Status'
  };
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

// ---------- 读取仓内数据 ----------
function readNDX() {
  if (!fs.existsSync(NDX)) return [];
  // NDX 列布局（制表符分隔）:
  // 0=date, 1=slug(vendor), 2=type, 3=hash, 4=rel(evidence json path),
  // 5=commit(optional), 6=run_url(optional, 不渲染)
  return fs.readFileSync(NDX, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(l => {
      const cols = l.split('\t');
      return {
        date: cols[0],
        slug: cols[1],
        type: cols[2],
        hash: cols[3],
        rel: cols[4],
        commit: cols[5] || '',
        // run_url / snapshot 等外链绝不向页面暴露
        run_url_internal: cols[6] || ''
      };
    });
}

function safeReadJSON(relPath) {
  try {
    const p = path.join(ROOT, relPath || '');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p,'utf8'));
  } catch {
    return null;
  }
}

function readMateriality() {
  const map = new Map();
  if (!fs.existsSync(MATERIALITY_CSV)) return map;
  for (const l of readLines(MATERIALITY_CSV)) {
    const cols = l.split(',');
    const vendor = cols[0];
    const score  = Number(cols[1]||0);
    const impact = cols[2] || '';
    if (vendor) map.set(vendor, {score, impact});
  }
  return map;
}

function fallbackMateriality(records){
  const weights = {
    pricing:3,
    dpa:3,
    tos:2,
    privacy:2,
    subprocessors:2,
    status:1,
    other:1
  };
  let score = 0;
  for (const r of records) {
    const k = String(r.type||'other').toLowerCase();
    score += (weights[k] || weights.other);
  }
  const impact = score>=6 ? 'High' : (score>=3 ? 'Medium' : 'Low');
  return { score, impact };
}

// ---------- 渲染单个 vendor 的报告页 ----------
function renderPack(vendor, records, matInfo, alsoSeeLinks, verifiedBadge) {
  // 聚合“最近90天发生了什么”
  const buckets = {};
  for (const r of records) {
    (buckets[r.type] = buckets[r.type] || []).push(r);
  }

  const what = Object.entries(buckets)
    .map(([k, arr]) =>
      `<li><b>${escapeHtml(pickTopic(k))}</b>: ${arr.length} change(s) in last 90 days</li>`
    ).join('');

  const so = Object.keys(buckets)
    .map(k => changeImpact(k))
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' · ');

  const nowBullets = [
    'Lock pricing / request grandfathering at renewal',
    'Review arbitration/termination with Legal',
    'Update internal register & notify stakeholders if material'
  ];

  // 证据表
  const rows = records.slice(0, 300).map(r => {
    // evidenceHref 只允许站内 JSON：/evidence/<vendor>/<file>.json
    const evidenceHref = '/' + String(r.rel || '').replace(/\\/g, '/');

    // hash 显示前8字符，零hash显示 —
    const h = String(r.sha256 || r.hash || '').toLowerCase();
    const displayHash = isZeroHash(h)
      ? '&mdash;'
      : `<code>#${escapeHtml(h.slice(0,8))}</code>`;

    // 摘要（diff excerpt），不用原文全贴，只给“excerpt”占位+title
    const before = (r.diff_excerpt_before || '').toString().trim();
    const after  = (r.diff_excerpt_after  || '').toString().trim();
    const excerptTxt = (before || after)
      ? `${before}${after ? (' → '+after) : ''}`
      : '';
    const excerptSafe = excerptTxt
      ? escapeHtml(excerptTxt.slice(0,240))
      : '';
    const excerptCell = excerptSafe
      ? `<td title="${excerptSafe}">excerpt</td>`
      : '<td></td>';

    return `<tr>
      <td>${escapeHtml(r.date || '')}</td>
      <td>${escapeHtml(pickTopic(r.type))}</td>
      <td>${displayHash}</td>
      <td><a href="${escapeHtml(evidenceHref)}" rel="nofollow">evidence</a></td>
      ${excerptCell}
    </tr>`;
  }).join('');

  const lastDate = records.map(r=>r.date).sort().slice(-1)[0] || '';
  const total = records.length;
  const impactChip = (matInfo?.impact || 'Low');

  // top badges
  const badges = `
<div class="badges">
  <span class="chip">Last change: ${escapeHtml(lastDate||'n/a')}</span>
  <span class="chip evidence">Evidence: ${total}</span>
  <span class="chip impact">Impact: ${escapeHtml(impactChip)}</span>
  ${verifiedBadge ? `<span class="chip verified">${verifiedBadge}</span>` : ''}
</div>`.trim();

  // CTA 区域
  const vParam = encodeURIComponent(vendor);
  const ctaEnable = INTAKE_FORM_URL
    ? `<a class="btn primary" href="${escapeHtml(joinWithUTM(INTAKE_FORM_URL, `vendor=${vParam}`))}">Enable alerts for ${escapeHtml(vendor)}</a>`
    : '';
  const ctaBuy = STRIPE_LINK_PORTFOLIO
    ? `<a class="btn" href="${escapeHtml(joinWithUTM(STRIPE_LINK_PORTFOLIO))}">Buy Portfolio $2,988/yr</a>`
    : '';
  const ctaHome = `<a class="btn ghost" href="${ORIGIN}/">Home</a>`;

  // 也看这些（Subprocessors）
  const also = alsoSeeLinks.length
    ? `<div class="also">Also see: ${
        alsoSeeLinks
          .map(p => `<a href="/who-uses/${escapeHtml(slugify(p))}/" class="muted">${escapeHtml(p)}</a>`)
          .join(' · ')
      }</div>`
    : '';

  // 结构化数据
  const ld = {
    '@context':'https://schema.org',
    '@type':'Report',
    name: `${vendor} Change Pack ${CUR}`,
    datePublished: new Date().toISOString(),
    about: vendor
  };
  const ldJson = JSON.stringify(ld);

  // 最终 HTML（注意：不输出<header>，避免重复导航。
  // header 会在后续 theme_injector.js 注入成统一站点导航，只会有横向那个。）
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(vendor)} Change Pack (${CUR})</title>
<meta name="description" content="Verifiable public changes for ${escapeHtml(vendor)} in ${CUR}">
<link rel="canonical" href="/reports/${CUR}/${escapeHtml(vendor)}/">

<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/assets/cg-theme.css">

<!-- 强行锁浅色，彻底避免深色背景把右侧弄成一大块黑 -->
<meta name="color-scheme" content="light">

<script type="application/ld+json">${ldJson}</script>

<style>
  /* 强制白底+黑字，覆盖深色模式 */
  body{
    background:#fff !important;
    color:#000 !important;
    font-family:system-ui,Segoe UI,Arial,sans-serif;
    line-height:1.55;
  }

  main.container{
    padding-top:24px;
    padding-bottom:24px;
  }

  .badges{
    display:flex;
    gap:8px;
    flex-wrap:wrap;
    margin:8px 0 16px;
    font-size:12px;
    line-height:1.4;
  }
  .chip{
    background:#eef;
    padding:4px 8px;
    border-radius:8px;
  }
  .chip.evidence{ background:#efe; }
  .chip.impact{ background:#fdecc8; }
  .chip.verified{ background:#e6f4ea; }

  .cta{
    display:flex;
    gap:8px;
    flex-wrap:wrap;
    justify-content:flex-start;
    margin:4px 0 16px;
  }
  .btn{
    display:inline-block;
    padding:8px 12px;
    border-radius:8px;
    border:1px solid #ddd;
    text-decoration:none;
    font-size:14px;
    line-height:1.4;
    background:#fff;
    color:#000;
  }
  .btn.primary{
    background:#111;
    color:#fff;
    border-color:#111;
  }
  .btn.ghost{
    background:transparent;
  }
  .muted{
    color:#666;
    text-decoration:none;
    font-size:14px;
  }

  .also{
    font-size:14px;
    color:#444;
    margin-bottom:12px;
  }

  h1{
    margin:0 0 8px;
    font-size:20px;
    font-weight:600;
  }
  h3{
    margin:20px 0 8px;
    font-size:16px;
    font-weight:600;
  }

  table{
    border-collapse:collapse;
    width:100%;
  }
  td,th{
    border:1px solid #ddd;
    padding:8px;
    font-size:14px;
    vertical-align:top;
  }
  thead th{
    background:#fafafa;
  }
  code{
    background:#f5f5f5;
    padding:2px 4px;
    border-radius:4px;
    font-size:12px;
  }
  .small{
    color:#666;
    font-size:12px;
    margin-top:12px;
  }
</style>
</head>
<body>
<main class="container">
  <h1>${escapeHtml(vendor)} — Change Pack (${CUR})</h1>

  ${badges}

  <div class="cta">
    ${ctaEnable}${ctaBuy}${ctaHome}
  </div>

  ${also}

  <h3>What</h3>
  <ul>${what || '<li>No public changes in last 90 days</li>'}</ul>

  <h3>So What</h3>
  <p>${so || 'No material impact detected'}</p>

  <h3>Now What</h3>
  <ul>${nowBullets.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>

  <h3>Verifiable evidence</h3>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Type</th>
        <th>Hash</th>
        <th>Link</th>
        <th>Excerpt</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="5">No evidence available</td></tr>'}
    </tbody>
  </table>

  <p class="small">
    Only internal evidence JSON links are shown. No build or repository links are exposed.
  </p>
</main>
</body>
</html>`;

  return html;
}

// ---------- 主流程 ----------
(function main(){
  // 1. 读 NDX，只要 <=90天的记录，必须有 date/slug/rel
  const ndxRaw = readNDX()
    .filter(r => r && r.date && r.slug && r.rel && daysSince(r.date) <= 90);

  if (!ndxRaw.length) {
    console.log('no recent evidence; skip');
    return;
  }

  const matMap = readMateriality();

  // 2. 回填扩展字段（不暴露 run_url / snapshot）
  const recs = ndxRaw.map(r => {
    const json = safeReadJSON(r.rel) || {};
    const sha256 = json.sha256 || json.fingerprint || r.hash || '';
    const commit  = r.commit || json.commit || '';

    const diff_before = (json.diff_excerpt_before || '').toString();
    const diff_after  = (json.diff_excerpt_after  || '').toString();

    const processors = Array.isArray(json.processors)
      ? json.processors.slice(0,5).map(String)
      : [];

    return {
      ...r,
      sha256,
      commit,
      diff_excerpt_before: diff_before,
      diff_excerpt_after: diff_after,
      processors
    };
  });

  // 3. 按 vendor 分组
  const byVendor = new Map();
  for (const r of recs) {
    const arr = byVendor.get(r.slug) || [];
    arr.push(r);
    byVendor.set(r.slug, arr);
  }

  // 4. 只出 Top 50（证据数量多的）
  const top = [...byVendor.entries()]
    .sort((a,b)=> b[1].length - a[1].length)
    .slice(0,50);

  // 5. 输出到 /reports/<YYYY-MM>/<vendor>/index.html
  const base = path.join(REPORT_ROOT, CUR);
  ensureDir(base);

  for (const [vendor, arr0] of top) {
    const arr = arr0.slice().sort((a,b)=> a.date.localeCompare(b.date));

    const matInfo = matMap.get(vendor) || fallbackMateriality(arr);

    // Verified badge（只展示 hash/commit 短指纹文本，不加链接）
    let verifiedBadge = '';
    const verified = [...arr].reverse().find(x => !isZeroHash(x.sha256||x.hash));
    if (verified) {
      const h8 = String(verified.sha256 || verified.hash).slice(0,8);
      const commitShort = verified.commit ? String(verified.commit).slice(0,7) : '';
      verifiedBadge = `Verified • #${escapeHtml(h8)}${commitShort?(' • '+escapeHtml(commitShort)) : ''}`;
    }

    // Also see: 取出 subprocessor 列表（去重，最多5个）
    const processors = new Set();
    for (const r of arr) {
      if ((r.type||'').toLowerCase().includes('subprocessor')) {
        (r.processors||[]).forEach(p => processors.add(p));
      }
    }
    const alsoSeeLinks = [...processors].slice(0,5);

    const outDir = path.join(base, vendor);
    ensureDir(outDir);

    const html = renderPack(vendor, arr, matInfo, alsoSeeLinks, verifiedBadge);
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    console.log('pack:', vendor, arr.length, 'impact=', matInfo.impact);
  }
})();
