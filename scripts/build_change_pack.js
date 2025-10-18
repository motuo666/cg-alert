#!/usr/bin/env node
/**
 * 从 data/evidence.ndx 生成 Change Pack（/reports/<YYYY-MM>/<vendor>/index.html）
 * 关键修正：
 * - 绝不渲染/拼接 GitHub run/仓库链接（run_url、actions、/runs/ 等一律丢弃）
 * - Proof/Verified 只指向站内快照（/reports/proof/...）。若 evidence JSON 有 proof_url 且安全，则用之；否则用本地推导
 * - 修复换行分隔符：split(/\r?\n/)（原来写成了 \\n 导致不分行）
 * - 即使 evidence JSON 仍留有 run_url 字段，也不会被读取/输出
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

// 外部可配
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const INTAKE_FORM_URL = process.env.INTAKE_FORM_URL || '';
const STRIPE_LINK_PORTFOLIO = process.env.STRIPE_LINK_PORTFOLIO || '';
const PROOF_BASE = process.env.PROOF_BASE || (ORIGIN + '/reports/proof');

// ---------- 小工具 ----------
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
  const utm = `utm_source=email&utm_medium=triggered&utm_campaign=cp_${CUR}`;
  return url + join + (extraParams ? `${extraParams}&` : '') + utm;
}
// 站内快照路径：evidence/<vendor>/<file>.json → /reports/proof/<vendor>/<file>.html
function buildProofFromRel(rel) {
  const r = String(rel || '');
  if (!r.startsWith('evidence/')) return '';
  const parts = r.split('/');
  if (parts.length < 3) return '';
  const vendor = parts[1];
  const base = parts.slice(2).join('/').replace(/\.json$/i, '');
  return `${PROOF_BASE}/${vendor}/${base}.html`;
}
// 任何疑似 GitHub/Actions/run 的 URL 直接丢弃
function safeProof(url){
  const u = String(url||'');
  if (!u) return '';
  if (/github\.com|actions|workflow|\/runs?\//i.test(u)) return '';
  return u;
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
    .split(/\r?\n/)               // ✅ 修正分隔符
    .filter(Boolean)
    .map(l => {
      const cols = l.split('\t');
      return {
        date: cols[0], slug: cols[1], type: cols[2],
        hash: cols[3], rel: cols[4],
        commit: cols[5] || '',
        // 第 7 列可能是 run_url，但我们绝不对外使用
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

    const proofHref = safeProof(r.proof_url || '');
    const proof = proofHref ? `<a href="${escapeHtml(proofHref)}" target="_blank" rel="noopener nofollow">snapshot</a>` : '';

    const before = (r.diff_excerpt_before || '').trim();
    const after  = (r.diff_excerpt_after  || '').trim();
    const excerptTxt = (before || after) ? `${before}${after?(' → '+after):''}` : '';
    const excerpt = excerptTxt ? escapeHtml(excerptTxt.slice(0,240)) : '';
    const excerptCell = excerpt ? `<td title="${excerpt}">excerpt</td>` : '<td></td>';

    return `<tr>
      <td>${escapeHtml(r.date || '')}</td>
      <td>${escapeHtml(pickTopic(r.type))}</td>
      <td>${display}</td>
      <td><a href="${escapeHtml(evidenceHref)}" rel="nofollow">evidence</a></td>
      <td>${proof}</td>
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
  <thead><tr><th>Date</th><th>Type</th><th>Hash</th><th>Link</th><th>Proof</th><th>Excerpt</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6">No evidence available</td></tr>'}</tbody>
</table>
<p class="small">“Proof” links to a stable snapshot hosted on cg-alert.com. Internal build links are never exposed.</p>
</body>
</html>`;
  return html;
}

// ---------- 主流程 ----------
(function main(){
  const ndxRaw = readNDX().filter(r => r && r.date && r.slug && r.rel && daysSince(r.date) <= 90);
  if (!ndxRaw.length) { console.log('no recent evidence; skip'); return; }

  const matMap = readMateriality();

  // 将 evidence JSON 的安全字段回填；任何 run_url 一概忽略
  const recs = ndxRaw.map(r => {
    const json = safeReadJSON(r.rel) || {};
    const sha256 = json.sha256 || json.fingerprint || r.hash || '';
    const commit  = r.commit || json.commit || '';

    // 只产生“站内快照” proof_url
    const proof_url = safeProof(json.proof_url) || buildProofFromRel(r.rel);

    const diff_before = (json.diff_excerpt_before || '').toString();
    const diff_after  = (json.diff_excerpt_after  || '').toString();
    const processors = Array.isArray(json.processors) ? json.processors.slice(0,5).map(String) : [];

    return { ...r, sha256, commit, proof_url, diff_excerpt_before: diff_before, diff_excerpt_after: diff_after, processors };
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

    // Verified（最近一个非零 hash），仅附“snapshot”链接
    let verifiedBadge = '';
    const verified = [...arr].reverse().find(x => !isZeroHash(x.sha256||x.hash));
    if (verified) {
      const h8 = String(verified.sha256 || verified.hash).slice(0,8);
      const commitShort = verified.commit ? String(verified.commit).slice(0,7) : '';
      const snap = verified.proof_url ? `<a href="${escapeHtml(verified.proof_url)}" target="_blank" rel="noopener nofollow">snapshot</a>` : '';
      verifiedBadge = `Verified • #${escapeHtml(h8)}${commitShort?(' • '+escapeHtml(commitShort)) : ''}${snap?(' • '+snap):''}`;
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
