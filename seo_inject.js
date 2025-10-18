#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// 配置
const ROOT = process.cwd();
const EXCLUDES = new Set(['.git', '.github', 'node_modules', '.cache']);
const INTAKE = process.env.INTAKE_FORM_URL || '';
const STRIPE = process.env.STRIPE_LINK_PORTFOLIO || '';
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
let scanned = 0, seoFiles = 0, seoInjected = 0, ctaFiles = 0, ctaInjected = 0;

// 遍历文件
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDES.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && p.endsWith('.html')) out.push(p);
  }
  return out;
}

// 确保 SEO 标签
function ensureSeo(html, fp) {
  let changed = false;
  if (!/<head[^>]*>/i.test(html) || !/<\/head>/i.test(html)) return { html, changed };

  // 插入 canonical 链接
  if (!/rel=["']canonical["']/i.test(html)) {
    const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
    const page = '/' + rel.replace(/index\.html$/i, '');
    html = html.replace(/<\/head>/i, `  <link rel="canonical" href="${ORIGIN}${page}">\n</head>`);
    changed = true;
  }

  // 插入 JSON-LD schema
  if (!/application\/ld\+json/i.test(html)) {
    const jsonld = {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "CG Alert — Evidence-backed vendor change alerts",
      "url": ORIGIN,
      "description": "Monitor vendor public pages (Pricing/ToS/DPA/Subprocessors/Status) and get verifiable change evidence."
    };
    html = html.replace(/<\/head>/i, `  <script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n</head>`);
    changed = true;
  }

  // 插入 meta description
  if (!/name=["']description["']/i.test(html)) {
    html = html.replace(/<\/head>/i, `  <meta name="description" content="Monitor vendor public changes and receive verifiable evidence cards for renewals & compliance.">\n</head>`);
    changed = true;
  }

  return { html, changed };
}

// 生成 CTA Block
function ctaBlock() {
  const btns = [];
  if (INTAKE) btns.push(`<a id="cg-enable-alerts" class="btn" rel="nofollow" href="${INTAKE}">Enable alerts</a>`);
  if (STRIPE) btns.push(`<a id="cg-buy-portfolio" class="btn secondary" rel="nofollow" href="${STRIPE}">Buy Portfolio</a>`);
  if (!btns.length) return '';

  const js = `<script>(function(){try{var qs=location.search;if(qs&&/utm_/i.test(qs)){["cg-enable-alerts","cg-buy-portfolio"].forEach(function(id){var el=document.getElementById(id);if(!el||!el.href)return;if(el.href.indexOf("?")===-1){el.href+=qs;}else{el.href+="&"+qs.slice(1);}})}}catch(e){}})();</script>`;
  return ['<!-- CG-CTA-INJECT START -->',
    `<div class="cg-cta" style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap">`,
    btns.join('\n'), `</div>`, js, '<!-- CG-CTA-INJECT END -->'].join('\n');
}

// 确保 CTA Block
function ensureCta(html) {
  if (/CG-CTA-INJECT START/.test(html)) return { html, changed: false };
  const block = ctaBlock();
  if (!block) return { html, changed: false };
  
  if (/h1/i.test(html)) {
    html = html.replace(/(<h1[^>]*>[\s\S]*?<\/h1>)/i, `$1\n${block}`);
    return { html, changed: true };
  }
  if (/main/i.test(html)) {
    html = html.replace(/<main[^>]*>/i, m => `${m}\n${block}\n`);
    return { html, changed: true };
  }
  if (/body/i.test(html)) {
    html = html.replace(/<body[^>]*>/i, m => `${m}\n${block}\n`);
    return { html, changed: true };
  }
  return { html, changed: false };
}

// 处理 HTML 文件
function process(fp) {
  let html = fs.readFileSync(fp, 'utf8');
  let touched = false;
  
  seoFiles++; 
  const s1 = ensureSeo(html, fp);
  if (s1.changed) {
    html = s1.html;
    seoInjected++;
    touched = true;
  }
  
  ctaFiles++;
  const s2 = ensureCta(html);
  if (s2.changed) {
    html = s2.html;
    ctaInjected++;
    touched = true;
  }

  if (touched) fs.writeFileSync(fp, html.endsWith('\n') ? html : html + '\n', 'utf8');
}

// 扫描 HTML 文件
const roots = [ROOT, 'vendors', 'updates', 'public', 'public/vendors', 'public/updates', 'site', 'build', 'dist', 'docs', 'out']
  .map(p => path.isAbsolute(p) ? p : path.join(ROOT, p))
  .filter(fs.existsSync);

let files = [];
for (const r of roots) files.push(...walk(r));
files = Array.from(new Set(files)); scanned = files.length;
files.forEach(process);

// 输出统计
console.log(`Scanned HTML files: ${scanned}`);
console.log(`SEO Inject - files: ${seoFiles} / injected: ${seoInjected}`);
console.log(`CTA Inject - files: ${ctaFiles} / injected: ${ctaInjected}`);
