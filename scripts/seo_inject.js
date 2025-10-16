#!/usr/bin/env node
/**
 * seo_inject.js v2
 * - 递归扫描全仓库 HTML（排除 .git/.github/node_modules/.cache）
 * - 幂等注入 canonical / description / JSON-LD
 * - 在首个 <h1> 后注入 CTA 标记块（CG-CTA-INJECT），无 <h1> 则插入 <main>/<body>
 * - 控制：INTAKE_FORM_URL / STRIPE_LINK_PORTFOLIO 任一存在才注入 CTA
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EXCLUDES = new Set(['.git', '.github', 'node_modules', '.cache']);
const INTAKE = process.env.INTAKE_FORM_URL || '';
const STRIPE = process.env.STRIPE_LINK_PORTFOLIO || '';
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';

let scanned = 0, seoFiles = 0, seoInjected = 0, ctaFiles = 0, ctaInjected = 0;

function listHtml(dir) {
  const out = [];
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of ents) {
    if (EXCLUDES.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { out.push(...listHtml(p)); continue; }
    if (!e.isFile()) continue;
    if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

function ensureSeo(html, filePath) {
  let changed = false;
  if (!/<head[^>]*>/i.test(html) || !/<\/head>/i.test(html)) return { html, changed };
  // canonical
  if (!/rel=["']canonical["']/i.test(html)) {
    const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
    const pagePath = '/' + rel.replace(/index\.html$/i, '');
    html = html.replace(/<\/head>/i, `  <link rel="canonical" href="${SITE_ORIGIN}${pagePath}">\n</head>`);
    changed = true;
  }
  // JSON-LD
  if (!/application\/ld\+json/i.test(html)) {
    const jsonld = {
      "@context":"https://schema.org",
      "@type":"WebPage",
      "name":"CG Alert — Evidence-backed vendor change alerts",
      "url": SITE_ORIGIN,
      "description":"Monitor vendor public pages (Pricing/ToS/DPA/Subprocessors/Status) and get verifiable change evidence."
    };
    html = html.replace(/<\/head>/i, `  <script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n</head>`);
    changed = true;
  }
  // description
  if (!/name=["']description["']/i.test(html)) {
    html = html.replace(/<\/head>/i, `  <meta name="description" content="Monitor vendor public changes and receive verifiable evidence cards for renewals & compliance.">\n</head>`);
    changed = true;
  }
  return { html, changed };
}

function buildCtaBlock() {
  const btns = [];
  if (INTAKE) btns.push(`<a id="cg-enable-alerts" class="btn" rel="nofollow" href="${INTAKE}">Enable alerts</a>`);
  if (STRIPE) btns.push(`<a id="cg-buy-portfolio" class="btn secondary" rel="nofollow" href="${STRIPE}">Buy Portfolio</a>`);
  if (!btns.length) return ''; // 两个变量都空 → 不注入
  const js = `<script>(function(){try{var qs=location.search;if(qs&&/utm_/i.test(qs)){["cg-enable-alerts","cg-buy-portfolio"].forEach(function(id){var el=document.getElementById(id);if(!el||!el.href)return;if(el.href.indexOf("?")===-1){el.href+=qs;}else{el.href+="&"+qs.slice(1);}})}}catch(e){}})();</script>`;
  return [
    '<!-- CG-CTA-INJECT START -->',
    `<div class="cg-cta" style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap">`,
    btns.join('\n'),
    `</div>`,
    js,
    '<!-- CG-CTA-INJECT END -->'
  ].join('\n');
}

function ensureCta(html) {
  if (/CG-CTA-INJECT START/.test(html)) return { html, changed: false };
  const block = buildCtaBlock();
  if (!block) return { html, changed: false };
  if (/<h1[^>]*>[\s\S]*?<\/h1>/i.test(html)) {
    html = html.replace(/(<h1[^>]*>[\s\S]*?<\/h1>)/i, `$1\n${block}`);
    return { html, changed: true };
  }
  if (/<main[^>]*>/i.test(html)) {
    html = html.replace(/<main[^>]*>/i, (m) => `${m}\n${block}\n`);
    return { html, changed: true };
  }
  if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body[^>]*>/i, (m) => `${m}\n${block}\n`);
    return { html, changed: true };
  }
  return { html, changed: false };
}

function run() {
  const roots = [
    ROOT,                    // 根 index.html
    path.join(ROOT, 'vendors'),
    path.join(ROOT, 'updates'),
    path.join(ROOT, 'public'),
    path.join(ROOT, 'public/vendors'),
    path.join(ROOT, 'public/updates'),
    path.join(ROOT, 'site'),
    path.join(ROOT, 'build'),
    path.join(ROOT, 'dist'),
    path.join(ROOT, 'docs'),
    path.join(ROOT, 'out')
  ].filter(fs.existsSync);

  let files = [];
  for (const r of roots) files.push(...listHtml(r));
  files = Array.from(new Set(files));
  scanned = files.length;

  files.forEach((p) => {
    let html = fs.readFileSync(p, 'utf8');
    let changed = false;

    seoFiles++;
    const s1 = ensureSeo(html, p); if (s1.changed) { html = s1.html; seoInjected++; changed = true; }

    ctaFiles++;
    const s2 = ensureCta(html); if (s2.changed) { html = s2.html; ctaInjected++; changed = true; }

    if (changed) fs.writeFileSync(p, html.endsWith('\n') ? html : html + '\n', 'utf8');
  });

  console.log(`Scanned HTML files: ${scanned}`);
  console.log(`SEO Inject - files: ${seoFiles} / injected: ${seoInjected}`);
  console.log(`CTA Inject - files: ${ctaFiles} / injected: ${ctaInjected}`);
  if (!INTAKE && !STRIPE) {
    console.log('CTA note: INTAKE_FORM_URL & STRIPE_LINK_PORTFOLIO both empty → CTA disabled.');
  }
}

run();
