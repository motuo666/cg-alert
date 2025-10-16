#!/usr/bin/env node
/**
 * 读取 data/evidence.ndx → 生成 Change Pack（/reports/<YYYY-MM>/<vendor>/index.html）
 * 增强：
 * - 首屏徽章：Last change / Evidence / Impact（材料性评分）
 * - Verified 徽章：从 evidence JSON / ndx 读取 sha256/hash + commit/run_url
 * - 证据表支持 Proof（GH Run 链接）与 Excerpt（变化片段摘要）
 * - CTA（Enable alerts / Buy Portfolio / Home），未配置则自动隐藏
 * - 兼容老数据（无 commit/run_url/sha256 时自动降级显示）
 *
 * 依赖（可选，若不存在则优雅降级）：
 * - data/materiality.csv（由 scripts/materiality_score.js 生成）
 * - evidence JSON 中可能含字段：sha256 / fingerprint / commit / run_url / diff_excerpt_before / diff_excerpt_after / processors
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

// 外部可配（不配就隐藏相关按钮）
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const INTAKE_FORM_URL = process.env.INTAKE_FORM_URL || '';              // Google Form 基础链接（不带 ?）
const STRIPE_LINK_PORTFOLIO = process.env.STRIPE_LINK_PORTFOLIO || '';  // Stripe Payment Link（不带 ?）

// ---------- 工具 ----------
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
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
  const utm = `utm_source=email&utm_medium=triggered&utm_campaign=cp_${CUR}`;
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

// ---------- 数据读取 ----------
function readNDX() {
  if (!fs.existsSync(NDX)) return [];
  // 支持 5~7 列：date, slug, type, hash, rel, [commit], [run_url]
  return fs.readFileSync(NDX, 'utf8').split(/\r?\n/).filter(Boolean).map(l => {
    const cols = l.split('\t');
    return {
      date: cols[0], slug: cols[1], type: cols[2],
      hash: cols[3], rel: cols[4],
      commit: cols[5] || '', run_url: cols[6] || ''
    };
  });
}

function safeReadJSON(relPath) {
  try {
    const p = path.join(ROOT, relPath || '');
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p,'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

function readMateriality() {
  const map = new Map();
  if (!fs.existsSync(MATERIALITY_CSV)) return map;
  // vendor,score,impact
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
  // 简易评分（无 data/materiality.csv 时使用）
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
  // 分类统计
  const buckets = {};
  for (const r of records) (buckets[r.type] = buckets[r.type] || []).push(r);

  // What / So What
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
  const rows = records.slice(0, 300).map(r => {
    const link = '/' + String(r.rel || '').replace(/\\/g, '/');
    const h = String(r.sha256 || r.hash || '').toLowerCase();
    const display = isZeroHash(h) ? '&mdash;' : `<code>#${escapeHtml(h.slice(0,8))}</code>`;
    const proof = r.run_url ? `<a href="${escapeHtml(r.run_url)}" target="_blank" rel="noopener">run</a>` : '';
    const excerpt = (r.diff_excerpt_before || r.diff_excerpt_after)
      ? escapeHtml(`${r.diff_excerpt_before||''}${r.diff_excerpt_after?(' → '+r.diff_excerpt_after):''}`.trim())
      : '';
    const excerptCell = excerpt ? `<td title="${excerpt}">excerpt</td>` : '<td></td>';
    return `<tr>
      <td>${escapeHtml(r.date || '')}</td>
      <td>${escapeHtml(pickTopic(r.type))}</td>
      <td>${display}</td>
      <td><a href="${escapeHtml(link)}">evidence</a></td>
      <td>${proof}</td>
      ${excerptCell}
    </tr>`;
  }).join('');

  // 徽章（含材料性与 Verified）
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

  // CTA（未配置的自动隐藏）
  const vParam = encodeURIComponent(vendor);
  const ctaEnable = INTAKE_FORM_URL
    ? `<a class="btn primary" href="${escapeHtml(joinWithUTM(INTAKE_FORM_URL, `vendor=${vParam}`))}">Enable alerts for ${escapeHtml(vendor)}</a>` : '';
  const ctaBuy = STRIPE_LINK_PORTFOLIO
    ? `<a class="btn" href="${escapeHtml(joinWithUTM(STRIPE_LINK_PORTFOLIO))}">Buy Portfolio $2,988/yr</a>` : '';
  const ctaHome = `<a class="btn ghost" href="${ORIGIN}/">Home</a>`;
  const also = alsoSeeLinks.length
    ? `<div class="also">Also see: ${alsoSeeLinks.map(p=>`<a href="/who-uses/${escapeHtml(slugify(p))}/" class="muted">${escapeHtml(p)}</a>`).join(' · ')}</div>`
    : '';

  const ctas = `
<div class="cta">
  ${ctaEnable}${ctaBuy}${ctaHome}
</div>
${also}`.trim();

  // JSON-LD
  const ld = { '@context':'https://schema.org','@type':'Report',
    name: `${vendor} Change Pack ${CUR}`,
    datePublished: new Date().toISOString(),
    about: vendor };
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
${ctas}
<h3>What</h3><ul>${what || '<li>No public changes in last 90 days</li>'}</ul>
<h3>So What</h3><p>${so || 'No material impact detected'}</p>
<h3>Now What</h3><ul>${nowBullets.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
<h3>Verifiable evidence</h3>
<table>
  <thead><tr><th>Date</th><th>Type</th><th>Hash</th><th>Link</th><th>Proof</th><th>Excerpt</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6">No evidence available</td></tr>'}</tbody>
</table>
<p class="small">All evidence from public pages; robots/sitemap/security.txt respected. Refund policy and terms as published on site. “Proof” links to the GitHub Actions run that observed or indexed the change (when available).</p>
</body>
</html>`;
  return html;
}

// ---------- 主流程 ----------
(function main(){
  const ndx = readNDX().filter(r => r && r.date && r.slug && r.rel && daysSince(r.date) <= 90);
  if (!ndx.length) { console.log('no recent evidence; skip'); return; }

  // 读取材料性（可选）
  const matMap = readMateriality();

  // 将 evidence JSON 增强字段塞回记录（sha256 / run_url / commit / diff excerpts / processors）
  const recs = ndx.map(r => {
    const json = safeReadJSON(r.rel);
    const sha256 = json?.sha256 || json?.fingerprint || r.hash || '';
    const run_url = r.run_url || json?.run_url || '';
    const commit  = r.commit  || json?.commit  || '';
    const diff_before = json?.diff_excerpt_before || '';
    const diff_after  = json?.diff_excerpt_after  || '';
    const processors = Array.isArray(json?.processors) ? json.processors.slice(0,5).map(String) : [];
    return { ...r, sha256, run_url, commit, diff_excerpt_before: diff_before, diff_excerpt_after: diff_after, processors };
  });

  // 分组
  const byVendor = new Map();
  for (const r of recs) {
    const arr = byVendor.get(r.slug) || [];
    arr.push(r);
    byVendor.set(r.slug, arr);
  }

  // 只渲染前 50（按证据数降序）
  const top = [...byVendor.entries()].sort((a,b)=>b[1].length - a[1].length).slice(0,50);

  const base = path.join(REPORT_ROOT, CUR);
  ensureDir(base);

  for (const [vendor, arr0] of top) {
    // 按日期排序
    const arr = arr0.slice().sort((a,b)=>a.date.localeCompare(b.date));

    // 材料性
    const matInfo = matMap.get(vendor) || fallbackMateriality(arr);

    // Verified 徽章（取最近一个非零 hash/sha256）
    let verifiedBadge = '';
    const verified = [...arr].reverse().find(x => !isZeroHash(x.sha256||x.hash));
    if (verified) {
      const h8 = String(verified.sha256 || verified.hash).slice(0,8);
      const commitShort = verified.commit ? String(verified.commit).slice(0,7) : '';
      const proofLink = verified.run_url ? `<a href="${escapeHtml(verified.run_url)}" target="_blank" rel="noopener">proof</a>` : '';
      verifiedBadge = `Verified • #${escapeHtml(h8)}${commitShort?(' • '+escapeHtml(commitShort)) : ''}${proofLink?(' • '+proofLink):''}`;
    }

    // Subprocessor “Also see” 链接（聚合去重）
    const processors = new Set();
    for (const r of arr) {
      if ((r.type||'').toLowerCase().includes('subprocessor')) {
        (r.processors||[]).forEach(p => processors.add(p));
      }
    }
    const alsoSeeLinks = [...processors].slice(0,5); // 最多展示 5 个

    // 渲染
    const outDir = path.join(base, vendor);
    ensureDir(outDir);
    const html = renderPack(vendor, arr, matInfo, alsoSeeLinks, verifiedBadge);
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    console.log('pack:', vendor, arr.length, 'impact=', matInfo.impact);
  }
})();
