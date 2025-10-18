#!/usr/bin/env node
/**
 * 从 data/evidence.ndx 生成 Change Pack（/reports/<YYYY-MM>/<vendor>/index.html）
 * —— no-snapshot 覆盖版 ——
 *
 * 目标：
 * - 彻底移除 “Proof/snapshot” 列与链接（不生成、不渲染）
 * - 绝不渲染/拼接任何 GitHub run/仓库链接（含 actions、/runs、workflow 等）
 * - 表格列固定为 5：Date / Type / Hash / Link / Excerpt
 * - “No evidence” 行使用 colspan="5"
 * - 其他 CTA/SEO 逻辑保持不变
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

// 外部可配（仅用于 CTA，不影响证据渲染）
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const INTAKE_FORM_URL = process.env.INTAKE_FORM_URL || '';
const STRIPE_LINK_PORTFOLIO = process.env.STRIPE_LINK_PORTFOLIO || '';

// ---------- 工具 ----------
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function escapeHtml(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
function slugify(s){ return String(s||'').toLowerCase().trim().replace(/[^a-z0-9.-]+/g,'-').replace(/^-+|-+$/g,''); }
function joinWithUTM(url, extraParams){
  const join = url.includes('?') ? '&' : '?';
  const utm = `utm_source=site&utm_medium=internal&utm_campaign=cp_${CUR}`;
  return url + join + (extraParams ? `${extraParams}&` : '') + utm;
}

// ---------- 业务映射 ----------
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

// ---------- 读取 ----------
function readNDX() {
  if (!fs.existsSync(NDX)) return [];
  // 支持 5~7 列：date, slug, type, hash, rel, [commit], [run_url]
  return fs.readFileSync(NDX, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(l => {
      const cols = l.split('\t');
      return {
        date: cols[0], slug: cols[1], type: cols[2],
        hash: cols[3], rel: cols[4],
        commit: cols[5] || '',
        // 第 7 列可能是 run_url（内部字段），但**不使用也不渲染**
        run_url_internal: cols[6] || ''
      };
    });
}

function safeReadJSON(relPath) {
  try {
    const p = path.join(ROOT, relPath || '');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p,'utf8'));
  } catch { return null; }
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
  const weights = { pricing:3, dpa:3, tos:2, privacy:2, subprocessors:2, status:1, other:1 };
  let score = 0;
  for (const r of records) {
    const k = String(r.type||'other').toLowerCase();
    score += (weights[k] || weights.other);
  }
  const impact = score>=6 ? 'High' : (score>=3 ? 'Medium' : 'Low');
  return { score, impact };
}

// ---------- 渲染 ----------
function renderPack(vendor, records, matInfo, alsoSeeLinks, verifiedBadge) {
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

  const rows = records.slice(0, 300).map(r => {
    const evidenceHref = '/' + String(r.rel || '').replace(/\\/g, '/');
    const h = String(r.sha256 || r.hash || '').toLowerCase();
    const display = isZeroHash(h) ? '&mdash;' : `<code>#${escapeHtml(h.slice(0,8))}</code>`;

    // 仅渲染站内 evidence 链接；不渲染任何 Proof/snapshot/run 相关链接
    const before = (r.diff_excerpt_before || '').toString().trim();
    const after  = (r.diff_excerpt_after  || '').toString().trim();
    const excerptTxt = (before || after) ? `${before}${after?(' → '+after):''}` : '';
    const excerpt = excerptTxt ? escapeHtml(excerptTxt.slice(0,240)) : '';
    const excerptCell = excerpt ? `<td title="${excerpt}">excerpt</td>` : '<td></td>';

    return `<tr>
      <td>${escapeHtml(r.date || '')}</td>
      <td>${escapeHtml(pickTopic(r.type))}</td>
      <td>${display}</td>
      <td><a href="${escapeHtml(evidenceHref)}" rel="nofollow">evidence</a></td>
      ${excerptCell}
    </tr>`;
  }).join('');

  const lastDate = records.map(r=>r.date).sort().slice(-1)[0] || '';
  const total = records.length;
  const impactChip = (matInfo?.impact || 'Low');
  const badges = `
<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 16px">
  <span style="background:#eef;padding:4px 8px;border-radius:8px">Last change: ${escapeHtml(lastDate||'n/a')}</span>
  <span style="background:#efe;padding:4px 8px;border-radius:8px">Evidence: ${total}</span>
  <span style="background:#fdecc8;padding:4px 8px;border-radius:8px">Impact: ${escapeHtml(impactChip)}</span>
  ${verifiedBadge ? `<span style="background:#e6f4ea;padding:4px 8px;border-radius:8px">${verifiedBadge}</span>` : ''}
</div>`.trim();

  const vParam = encodeURIComponent(vendor);
  const ctaEnable = INTAKE_FORM_URL
    ? `<a class="btn primary" href="${escapeHtml(joinWithUTM(INTAKE_FORM_URL, `vendor=${vParam}`))}">Enable alerts for ${escapeHtml(vendor)}</a>` : '';
  const ctaBuy = STRIPE_LINK_PORTFOLIO
    ? `<a class="btn" href="${escapeHtml(joinWithUTM(STRIPE_LINK_PORTFOLIO))}">Buy Portfolio $2,988/yr</a>` : '';
  const ctaHome = `<a class="btn ghost" href="${ORIGIN}/">Home</a>`;
  const also = alsoSeeLinks.length
    ? `<div class="also">Also see: ${alsoSeeLinks.map(p=>`<a href="/who-uses/${escapeHtml(slugify(p))}/" class="muted">${escapeHtml(p)}</a>`).join(' · ')}</div>`
    : '';

  const ld = { '@context':'https://schema.org','@type':'Report',
    name: `${vendor} Change Pack ${CUR}`,
    datePublished: new Date().toISOString(),
    about: vendor };
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
  .cta{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-start;margin:4px 0 16px}
  .btn{display:inline-block;padding:8px 12px;border-radius:8px;border:1px solid #ddd;text-decoration:none}
  .btn.primary{background:#111;color:#fff;border-color:#111}
  .btn.ghost{background:transparent}
  .muted{color:#666;text-decoration:none}
  table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}
  code{background:#f5f5f5;padding:2px 4px;border-radius:4px}
  h1{margin:0 0 8px} h3{margin:20px 0 8px}
  thead th{background:#fafafa}
  .small{color:#666;font-size:12px}
</style>
</head>
<body>
<h1>${escapeHtml(vendor)} — Change Pack (${CUR})</h1>
${badges}
<div class="cta">
  ${ctaEnable}${ctaBuy}${ctaHome}
</div>
${also}
<h3>What</h3><ul>${what || '<li>No public changes in last 90 days</li>'}</ul>
<h3>So What</h3><p>${so || 'No material impact detected'}</p>
<h3>Now What</h3><ul>${nowBullets.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
<h3>Verifiable evidence</h3>
<table>
  <thead><tr><th>Date</th><th>Type</th><th>Hash</th><th>Link</th><th>Excerpt</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5">No evidence available</td></tr>'}</tbody>
</table>
<p class="small">Only internal evidence JSON links are shown. No build or repository links are exposed.</p>
</body>
</html>`;
  return html;
}

// ---------- 主流程 ----------
(function main(){
  const ndxRaw = readNDX().filter(r => r && r.date && r.slug && r.rel && daysSince(r.date) <= 90);
  if (!ndxRaw.length) { console.log('no recent evidence; skip'); return; }

  const matMap = readMateriality();

  // 回填少量可用字段（绝不生成/渲染 proof / run）
  const recs = ndxRaw.map(r => {
    const json = safeReadJSON(r.rel) || {};
    const sha256 = json.sha256 || json.fingerprint || r.hash || '';
    const commit  = r.commit || json.commit || '';

    const diff_before = (json.diff_excerpt_before || '').toString();
    const diff_after  = (json.diff_excerpt_after  || '').toString();
    const processors = Array.isArray(json.processors) ? json.processors.slice(0,5).map(String) : [];

    return { ...r, sha256, commit, diff_excerpt_before: diff_before, diff_excerpt_after: diff_after, processors };
  });

  // 分组
  const byVendor = new Map();
  for (const r of recs) {
    const arr = byVendor.get(r.slug) || [];
    arr.push(r);
    byVendor.set(r.slug, arr);
  }

  // 仅渲染证据数 Top 50
  const top = [...byVendor.entries()].sort((a,b)=>b[1].length - a[1].length).slice(0,50);

  const base = path.join(REPORT_ROOT, CUR);
  ensureDir(base);

  for (const [vendor, arr0] of top) {
    const arr = arr0.slice().sort((a,b)=>a.date.localeCompare(b.date));

    const matInfo = matMap.get(vendor) || fallbackMateriality(arr);

    // Verified（最近一个非零 hash），不附任何链接
    let verifiedBadge = '';
    const verified = [...arr].reverse().find(x => !isZeroHash(x.sha256||x.hash));
    if (verified) {
      const h8 = String(verified.sha256 || verified.hash).slice(0,8);
      const commitShort = verified.commit ? String(verified.commit).slice(0,7) : '';
      verifiedBadge = `Verified • #${escapeHtml(h8)}${commitShort?(' • '+escapeHtml(commitShort)) : ''}`;
    }

    // Also see（Subprocessors）
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
