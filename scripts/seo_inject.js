#!/usr/bin/env node
/**
 * seo_inject.js v3 (drop-in)
 * 目标：
 *  - 幂等 & 去重：在注入前清理旧的 <title>/<meta desc>/<link rel=canonical>，
 *    以及上一轮我们注入的 WebPage JSON-LD 与 OG/Twitter 卡片，避免重复标签。
 *  - canonical 修正：把 public/site/build/dist/docs/out 这类输出目录前缀剥离，
 *    统一生成站点层级路径；index.html → 目录尾部斜杠；其它 .html 原样保留。
 *  - SEO 补强：若缺失则注入 <title>（优先保留旧值，否则用 H1 生成）、
 *    <meta name="description">（优先保留旧值，否则从首段文本截取）、
 *    WebPage JSON-LD、OG/Twitter 基础卡片。
 *  - CTA：与 v2 一致；只有设置 INTAKE_FORM_URL 或 STRIPE_LINK_PORTFOLIO 才注入。
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EXCLUDES = new Set(['.git', '.github', 'node_modules', '.cache']);
const INTAKE = process.env.INTAKE_FORM_URL || '';
const STRIPE = process.env.STRIPE_LINK_PORTFOLIO || '';
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://www.cg-alert.com').replace(/\/+$/,'');

// 这些目录如果出现在相对路径开头，会在 canonical 中剥离
const STRIP_LEADING = ['public','site','build','dist','docs','out'];

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

function extractFirst(re, html) {
  const m = re.exec(html);
  return m ? m[1].trim() : '';
}

function textFromTag(tag, html) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  return extractFirst(re, html).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
}

function deriveTitle(html, fallback='CG Alert — Evidence-backed vendor change alerts') {
  const oldTitle = extractFirst(/<title>([\s\S]*?)<\/title>/i, html);
  if (oldTitle) return oldTitle;
  const h1 = textFromTag('h1', html);
  if (h1) return `${h1} – CG Alert`;
  return fallback;
}

function deriveDescription(html, fallback='Monitor vendor public changes and receive verifiable evidence cards for renewals & compliance.') {
  const old = extractFirst(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i, html);
  if (old) return old;
  const p = textFromTag('p', html) || textFromTag('h1', html);
  const t = (p || '').replace(/\s+/g,' ').trim();
  return (t && t.length > 40) ? (t.length > 160 ? t.slice(0,157)+'…' : t) : fallback;
}

function filePathToCanonical(filePath) {
  // 相对仓库路径（统一斜杠）
  let rel = path.relative(ROOT, filePath).replace(/\\/g,'/');
  // 只保留最后一个根目录后的路径
  for (const lead of STRIP_LEADING) {
    if (rel.startsWith(lead + '/')) { rel = rel.slice(lead.length + 1); break; }
  }
  // index.html → 去掉并确保目录斜杠
  if (/\/index\.html$/i.test(rel)) {
    rel = rel.replace(/\/index\.html$/i, '/');
  } else if (/index\.html$/i.test(rel)) {
    rel = rel.replace(/index\.html$/i, '');
  }
  // 统一前导斜杠
  if (!rel.startsWith('/')) rel = '/' + rel;
  // 双斜杠压缩
  rel = rel.replace(/\/{2,}/g,'/');
  // 防止 /./ 之类
  rel = rel.replace(/\/\.\//g,'/');
  // 根目录空文件 -> '/'
  if (rel === '') rel = '/';
  return SITE_ORIGIN + rel;
}

function slugFromPath(filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g,'/');
  const base = rel.replace(/\/index\.html$/i,'').replace(/\.html$/i,'');
  const parts = base.split('/').filter(Boolean);
  return parts[parts.length - 1] || 'page';
}

function cleanHead(html) {
  if (!/<head[^>]*>/i.test(html) || !/<\/head>/i.test(html)) return html;

  // 1) 先删除我们可能注入过的 SEO 区块（通过标记或选择器）
  html = html
    .replace(/<!--\s*CG-SEO-INJECT START[\s\S]*?CG-SEO-INJECT END\s*-->/gi, '')
    .replace(/<!--\s*CG-CTA-INJECT START[\s\S]*?CG-CTA-INJECT END\s*-->/gi, (m)=>m); // CTA 在 body，不在 head，这里仅保留

  // 2) 清理重复基础标签（保留第一个，其余都删；策略：先全删，后统一注入一次）
  html = html
    .replace(/<title>[\s\S]*?<\/title>/ig, '')
    .replace(/<meta[^>]+name=["']description["'][^>]*>/ig, '')
    .replace(/<link[^>]+rel=["']canonical["'][^>]*>/ig, '');

  // 3) 清理我们上一轮注入的 WebPage JSON-LD（尽量不删别的类型）
  html = html.replace(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?"@type"\s*:\s*"(WebPage)"[\s\S]*?<\/script>\s*/ig,
    ''
  );

  // 4) 清理 OG/Twitter（为避免重复，全部移除后重建）
  html = html
    .replace(/<meta[^>]+property=["']og:[^"']+["'][^>]*>/ig, '')
    .replace(/<meta[^>]+name=["']twitter:[^"']+["'][^>]*>/ig, '');

  return html;
}

function ensureSeo(html, filePath) {
  if (!/<head[^>]*>/i.test(html) || !/<\/head>/i.test(html)) return { html, changed:false };

  const title = deriveTitle(html);
  const desc = deriveDescription(html);
  const canonical = filePathToCanonical(filePath);
  const slug = slugFromPath(filePath);
  const ogImage = `${SITE_ORIGIN}/og/default.png?slug=${encodeURIComponent(slug)}`;

  // 清理头部重复项再注入
  const before = html;
  html = cleanHead(html);

  // 统一注入块（带标记，便于后续幂等更新）
  const block = [
    '<!-- CG-SEO-INJECT START -->',
    `  <title>${escapeHtml(title)}</title>`,
    `  <meta name="description" content="${escapeHtml(desc)}">`,
    `  <link rel="canonical" href="${canonical}">`,
    // WebPage JSON-LD
    '  <script type="application/ld+json">' +
      JSON.stringify({
        "@context":"https://schema.org",
        "@type":"WebPage",
        "name": title,
        "url": canonical,
        "description": desc
      }) +
    '</script>',
    // OG/Twitter
    `  <meta property="og:title" content="${escapeHtml(title)}">`,
    `  <meta property="og:description" content="${escapeHtml(desc)}">`,
    `  <meta property="og:url" content="${canonical}">`,
    `  <meta property="og:site_name" content="CG Alert">`,
    `  <meta property="og:type" content="website">`,
    `  <meta property="og:image" content="${ogImage}">`,
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:title" content="${escapeHtml(title)}">`,
    `  <meta name="twitter:description" content="${escapeHtml(desc)}">`,
    `  <meta name="twitter:image" content="${ogImage}">`,
    '<!-- CG-SEO-INJECT END -->'
  ].join('\n');

  html = html.replace(/<\/head>/i, block + '\n</head>');

  return { html, changed: html !== before };
}

function escapeHtml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({
    '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'
  }[c]));
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
