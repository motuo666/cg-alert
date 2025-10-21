/**
 * scripts/generate_seo_pages.js  —— 覆盖版
 * Programmatic SEO 落地页（稳健：无数据也不报错）
 * - 输入：artifacts/daily_ops.json（已有产物）
 * - 可选：data/vendors.json（数组：["Okta","Snowflake",...]）
 * - 输出：public/seo/**.html
 * 关键改进：
 * 1) canonical 按页面类型分别正确指向 /seo/, /seo/vendor/:slug/, /seo/month/:ym/
 * 2) vendor 名称 HTML 转义 + slug 化，防注入&非法路径
 * 3) 对缺失文件完全容错，仍然成功生成基础页
 * 4) JSON-LD 针对 vendor 页增加 about 指向具体 vendor
 */

import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { loadJSON, ensureDir, writeText, fmtDate, yyyymm } from './util.js';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'public', 'seo');
ensureDir(OUT);

// ---------- helpers ----------
const origin = (process.env.SITE_ORIGIN || '').replace(/\/+$/, ''); // 去掉尾部斜杠

const escapeHtml = (s = '') =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

// “温和” slug：保留字母数字，空格/下划线/点/斜杠转短横线，其余去除
const slugify = (s = '') =>
  String(s)
    .trim()
    .toLowerCase()
    .replace(/[ _./]+/g, '-')      // 常见分隔符并归一
    .replace(/[^a-z0-9-]+/g, '')   // 去掉其它符号
    .replace(/^-+|-+$/g, '')       // 去头尾 -
    || 'vendor';

const canonical = (p = '') => (origin ? `${origin}${p}` : '');

// base layout（按需带 canonical）
const layout = (title, desc, body, canoPath, jsonLd = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title || '')}</title>
<meta name="description" content="${escapeHtml(desc || '')}">
${origin ? `<link rel="canonical" href="${canonical(canoPath)}">` : ''}
<meta property="og:title" content="${escapeHtml(title || '')}">
<meta property="og:description" content="${escapeHtml(desc || '')}">
<meta property="og:type" content="article">
<script type="application/ld+json">${JSON.stringify({
  "@context":"https://schema.org",
  "@type":"TechArticle",
  "headline": title,
  "datePublished": fmtDate(dayjs()),
  "about": "Vendor change monitoring evidence metrics",
  "publisher":{"@type":"Organization","name":"cg-alert"},
  ...jsonLd
})}</script>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,'Noto Sans',sans-serif;line-height:1.6;
       max-width:880px;margin:48px auto;padding:0 16px;color:#111}
  h1{font-size:1.9rem;margin:0 0 16px}
  h2{margin-top:28px}
  ul{padding-left:20px}
  code,pre{background:#f6f7f9;border-radius:6px;padding:2px 6px}
  .muted{color:#666}
</style>
</head><body><main>${body}</main></body></html>`;

// ---------- load data ----------
const daily = loadJSON(path.join(ROOT, 'artifacts', 'daily_ops.json'), null);
const vendorsInput = loadJSON(path.join(ROOT, 'data', 'vendors.json'), []); // 可选
const vendors = Array.isArray(vendorsInput) ? vendorsInput : [];

const now = dayjs();
const ym = daily?.YM || yyyymm(now);
const k = daily?.kpi || {};

// ---------- /seo/index.html ----------
const idxBody = `
<h1>Vendor Change Monitoring – ${escapeHtml(ym)}</h1>
<ul>
  <li>Evidence today: <strong>${k.evidence_today ?? 'n/a'}</strong></li>
  <li>Sent today: <strong>${k.sent_today ?? 'n/a'}</strong></li>
  <li>Hash coverage: <strong>${typeof k.hash_ratio === 'number' ? (k.hash_ratio * 100).toFixed(1) + '%' : 'n/a'}</strong></li>
  <li>TTD P95(h): <strong>${k.ttd_p95_hours ?? 'n/a'} <span class="muted">(n=${k.ttd_samples ?? 0})</span></strong></li>
  <li>Changed vendors (72h): <strong>${k.changed_vendors_72h ?? 'n/a'}</strong></li>
</ul>

<section>
  <h2>Vendors (sample)</h2>
  <ul>
    ${(vendors || []).slice(0, 100).map(v => {
      const name = escapeHtml(v);
      const slug = slugify(v);
      return `<li><a href="./vendor/${slug}/">${name}</a></li>`;
    }).join('\n')}
  </ul>
  ${!vendors?.length ? '<p class="muted">No vendor list yet. Pages will grow as data arrives.</p>' : ''}
</section>

<section>
  <h2>Monthly rollup</h2>
  <p>See <a href="./month/${escapeHtml(ym)}/">${escapeHtml(ym)}</a> KPI snapshot.</p>
</section>
`;

writeText(
  path.join(OUT, 'index.html'),
  layout(
    `Vendor Change Monitoring – ${ym}`,
    `Evidence metrics ${ym}`,
    idxBody,
    '/seo/'
  )
);

// ---------- /seo/vendor/:slug/index.html ----------
if (vendors.length) {
  const seen = new Set();
  vendors.slice(0, 1000).forEach(v => {
    const titleName = String(v || '').slice(0, 140);
    let slug = slugify(v);

    // 去重：同名/同 slug 的附加短随机后缀
    while (seen.has(slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    seen.add(slug);

    const dir = path.join(OUT, 'vendor', slug);
    ensureDir(dir);

    const vTitle = `${titleName} changes ${ym}`;
    const vDesc = `${titleName} vendor changes ${ym}`;

    const vBody = `
<h1>${escapeHtml(titleName)} – changes & evidence (${escapeHtml(ym)})</h1>
<p class="muted">Auto-generated landing. Data updates daily.</p>
<ul>
  <li><a href="../../">Back to SEO index</a></li>
  <li><a href="../">Vendor index</a></li>
</ul>`.trim();

    writeText(
      path.join(dir, 'index.html'),
      layout(
        vTitle,
        vDesc,
        vBody,
        `/seo/vendor/${slug}/`,
        { about: titleName } // JSON-LD 丰富一下 vendor 语义
      )
    );
  });
}

// ---------- /seo/month/:ym/index.html ----------
const monthDir = path.join(OUT, 'month', ym);
ensureDir(monthDir);

writeText(
  path.join(monthDir, 'index.html'),
  layout(
    `Monthly rollup ${ym}`,
    `Metrics rollup ${ym}`,
    `<h1>${escapeHtml(ym)} rollup</h1><pre>${escapeHtml(JSON.stringify(k, null, 2))}</pre>`,
    `/seo/month/${ym}/`
  )
);

console.log('SEO pages generated → public/seo');
