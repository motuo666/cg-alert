#!/usr/bin/env node
/**
 * seo_inject.js (idempotent)
 * 目标：
 * 1) 幂等注入 <title>/<meta description>/<link rel="canonical"> + JSON-LD（若缺）
 * 2) 在 <h1> 后注入 CTA（Enable alerts / Buy Portfolio），带标记块 CG-CTA-INJECT，幂等
 * 3) 统计并打印：SEO Inject / CTA Inject 的 files / injected
 *
 * 依赖：无（Node18+）。从 env 读取：
 * - INTAKE_FORM_URL（可选；缺失则不注入对应按钮）
 * - STRIPE_LINK_PORTFOLIO（可选；缺失则不注入对应按钮）
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGETS = [
  { dir: 'vendors', file: 'index.html', deep: true },
  { dir: 'updates', file: 'index.html', deep: false },
];

const INTAKE = process.env.INTAKE_FORM_URL || '';
const STRIPE = process.env.STRIPE_LINK_PORTFOLIO || '';

let seoFiles = 0, seoInjected = 0;
let ctaFiles = 0, ctaInjected = 0;

function walk(dir, deep) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const st = fs.statSync(abs);
  if (!st.isDirectory()) return out;
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(abs, ent.name);
    if (ent.isDirectory()) {
      if (deep) out.push(...walk(path.join(dir, ent.name), deep));
    } else if (ent.isFile() && ent.name === 'index.html') {
      out.push(p);
    }
  }
  return out;
}

function ensureSeo(html, filePath) {
  let changed = false;

  // <head> 块存在性
  if (!/<head[^>]*>/i.test(html) || !/<\/head>/i.test(html)) return { html, changed };

  // canonical（若缺，则用 SITE_ORIGIN + 相对路径）
  if (!/rel=["']canonical["']/i.test(html)) {
    const rel = path.relative(ROOT, filePath).replace(/\\/g, '/'); // vendors/foo/index.html
    const pagePath = '/' + rel.replace(/index\.html$/i, '');
    const origin = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
    const canonical = `<link rel="canonical" href="${origin}${pagePath}">`;
    html = html.replace(/<\/head>/i, `  ${canonical}\n</head>`);
    changed = true;
  }

  // JSON-LD（若缺，注入一个最小组织/网页结构化数据）
  if (!/application\/ld\+json/i.test(html)) {
    const origin = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
    const jsonld = {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "CG Alert — Evidence-backed vendor change alerts",
      "url": origin,
      "description": "Monitor vendor public pages (Pricing/ToS/DPA/Subprocessors/Status) and get verifiable change evidence."
    };
    const block = `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`;
    html = html.replace(/<\/head>/i, `  ${block}\n</head>`);
    changed = true;
  }

  // 若无 <meta name="description">，给一个兜底（不覆盖已有）
  if (!/name=["']description["']/i.test(html)) {
    const meta = `<meta name="description" content="Monitor vendor public changes and receive verifiable evidence cards for renewals & compliance.">`;
    html = html.replace(/<\/head>/i, `  ${meta}\n</head>`);
    changed = true;
  }

  return { html, changed };
}

function buildCtaBlock() {
  const buttons = [];
  if (INTAKE) {
    buttons.push(
      `<a id="cg-enable-alerts" class="btn" rel="nofollow" href="${INTAKE}">Enable alerts</a>`
    );
  }
  if (STRIPE) {
    buttons.push(
      `<a id="cg-buy-portfolio" class="btn secondary" rel="nofollow" href="${STRIPE}">Buy Portfolio</a>`
    );
  }
  if (buttons.length === 0) {
    return ''; // 不注入任何 CTA（保持幂等）
  }
  const js = `
<script>
(function(){
  try{
    var qs = location.search;
    if(qs && /utm_/i.test(qs)){
      ["cg-enable-alerts","cg-buy-portfolio"].forEach(function(id){
        var el = document.getElementById(id);
        if(!el || !el.href) return;
        if(el.href.indexOf("?") === -1){ el.href += qs; }
        else { el.href += "&" + qs.slice(1); }
      });
    }
  }catch(e){}
})();
</script>`.trim();

  return [
    '<!-- CG-CTA-INJECT START -->',
    `<div class="cg-cta" style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap">`,
    buttons.join('\n'),
    `</div>`,
    js,
    '<!-- CG-CTA-INJECT END -->'
  ].join('\n');
}

function ensureCta(html) {
  // 已存在标记则跳过
  if (/CG-CTA-INJECT START/.test(html)) return { html, changed: false };

  const block = buildCtaBlock();
  if (!block) return { html, changed: false };

  // 插到首个 <h1> 之后；若无 <h1>，则插到 <main> 起始或 <body> 内
  if (/<h1[^>]*>/i.test(html)) {
    html = html.replace(/(<h1[^>]*>[\s\S]*?<\/h1>)/i, `$1\n${block}`);
    return { html, changed: true };
  } else if (/<main[^>]*>/i.test(html)) {
    html = html.replace(/<main[^>]*>/i, (m) => `${m}\n${block}\n`);
    return { html, changed: true };
  } else if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body[^>]*>/i, (m) => `${m}\n${block}\n`);
    return { html, changed: true };
  }
  return { html, changed: false };
}

function processFile(p) {
  let html = fs.readFileSync(p, 'utf8');

  // 1) SEO
  seoFiles++;
  const s1 = ensureSeo(html, p);
  if (s1.changed) {
    seoInjected++;
    html = s1.html;
  }

  // 2) CTA（放在 SEO 之后）
  ctaFiles++;
  const s2 = ensureCta(html);
  if (s2.changed) {
    ctaInjected++;
    html = s2.html;
  }

  if (s1.changed || s2.changed) {
    fs.writeFileSync(p, html.endsWith('\n') ? html : html + '\n', 'utf8');
  }
}

function main() {
  let files = [];
  for (const t of TARGETS) {
    files = files.concat(walk(t.dir, t.deep));
  }
  files.forEach(processFile);

  // 输出摘要（供工作流 Summary/日志使用）
  console.log(`SEO Inject - files: ${seoFiles} / injected: ${seoInjected}`);
  console.log(`CTA Inject - files: ${ctaFiles} / injected: ${ctaInjected}`);

  // 非致命：不强制退出失败
}
main();
