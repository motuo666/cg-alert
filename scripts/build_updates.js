#!/usr/bin/env node
// build_updates.js — render /updates/index.html with CTA + search (+SEO guards)
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EVD_DIR = path.join(ROOT, 'evidence');
const REPORTS_DIR = path.join(ROOT, 'reports');

const NOW = new Date();
const Y = NOW.getUTCFullYear();
const M = String(NOW.getUTCMonth() + 1).padStart(2, '0');
const CUR = `${Y}-${M}`;

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const INTAKE_FORM_URL = process.env.INTAKE_FORM_URL || '';              // 可选：Google Form
const STRIPE_LINK_PORTFOLIO = process.env.STRIPE_LINK_PORTFOLIO || '';  // 可选：Stripe Payment Link

function listRecentBySlug(limit = 100) {
  const out = new Map(); // slug -> { last: Date, count: number }
  if (!fs.existsSync(EVD_DIR)) return [];
  for (const d of fs.readdirSync(EVD_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const slug = d.name;
    const dir = path.join(EVD_DIR, slug);
    let cnt = 0;
    let last = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!/\.json$/i.test(f)) continue;
      const p = path.join(dir, f);
      try {
        const st = fs.statSync(p);
        const t = +st.mtime;
        if (t > last) last = t;
        cnt++;
      } catch {}
    }
    if (cnt > 0) out.set(slug, { last: new Date(last), count: cnt });
  }
  const arr = [...out.entries()]
    .sort((a, b) => b[1].last - a[1].last)
    .slice(0, limit)
    .map(([slug, v]) => ({ slug, when: v.last, count: v.count }));
  return arr;
}

function existsPack(slug) {
  return fs.existsSync(path.join(REPORTS_DIR, CUR, slug, 'index.html'));
}

(function main() {
  const items = listRecentBySlug(200);
  const lis = items.map(it => {
    const slugEnc = encodeURIComponent(it.slug);
    const hasPack = existsPack(it.slug);
    const href = hasPack
      ? `/reports/${CUR}/${slugEnc}/`
      : `/updates/?q=${slugEnc}`;
    const when = it.when.toISOString().slice(0, 10);
    return `<li data-slug="${it.slug}">${when} — <a href="${href}">${it.slug}</a> <small>(${it.count})</small></li>`;
  }).join('\n');

  const robots = `<meta name="robots" content="noindex,follow">`;
  const canonical = `<link rel="canonical" href="/updates/">`;

  const ctaEnable = INTAKE_FORM_URL
    ? `<a id="cta-enable" class="btn primary" href="${INTAKE_FORM_URL}">Enable alerts</a>`
    : '';
  const ctaBuy = STRIPE_LINK_PORTFOLIO
    ? `<a id="cta-buy" class="btn" href="${STRIPE_LINK_PORTFOLIO}">Buy Portfolio $2,988/yr</a>`
    : '';
  const ctaHome = `<a class="btn ghost" href="${SITE_ORIGIN}/">Home</a>`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Updates — CG Alert</title>
  ${robots}
  ${canonical}
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{font-family:system-ui,Segoe UI,Arial;line-height:1.55;margin:0}
    .wrap{max-width:920px;margin:0 auto;padding:24px 16px}
    h1{margin:0 0 8px}
    .cta{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-start;margin:4px 0 16px}
    .btn{display:inline-block;padding:8px 12px;border-radius:8px;border:1px solid #ddd;text-decoration:none;color:#111}
    .btn.primary{background:#111;color:#fff;border-color:#111}
    .btn.ghost{background:transparent}
    .search{margin:8px 0 16px;display:flex;gap:8px}
    .search input{flex:1;padding:8px 10px;border:1px solid #ddd;border-radius:8px}
    ul{padding-left:18px}
    li{margin:6px 0}
    small{color:#666}
  </style>
</head>
<body>
<div class="wrap">
  <h1>Recent Updates</h1>
  <div class="cta">
    ${ctaEnable}${ctaBuy}${ctaHome}
  </div>

  <div class="search">
    <input id="q" type="search" placeholder="Filter by vendor, e.g. slack.com">
    <a id="go" class="btn">Search</a>
  </div>

  <ul id="list">
    ${lis || '<li>No recent updates.</li>'}
  </ul>
</div>

<script>
(function(){
  const CUR = ${JSON.stringify(CUR)};
  const utm = 'utm_source=site&utm_medium=updates&utm_campaign=cp_' + CUR;

  function addUTM(u){
    if(!u) return u;
    const hasQ = u.includes('?');
    return u + (hasQ ? '&' : '?') + utm;
  }

  // read q from URL
  const params = new URLSearchParams(location.search);
  const q = (params.get('q') || '').trim();
  const qInput = document.getElementById('q');
  const list = document.getElementById('list');
  const go = document.getElementById('go');

  qInput.value = q;

  // CTA: attach vendor + utm when q exists
  const enable = document.getElementById('cta-enable');
  if (enable) {
    let href = enable.getAttribute('href') || '';
    if (href) {
      if (q) {
        const sep = href.includes('?') ? '&' : '?';
        href = href + sep + 'vendor=' + encodeURIComponent(q);
      }
      enable.setAttribute('href', addUTM(href));
    }
  }
  const buy = document.getElementById('cta-buy');
  if (buy) buy.setAttribute('href', addUTM(buy.getAttribute('href')||''));

  // Filter list client-side
  function applyFilter(val){
    const v = (val||'').toLowerCase();
    let hit = 0;
    for (const li of list.querySelectorAll('li[data-slug]')) {
      const show = !v || li.dataset.slug.toLowerCase().includes(v);
      li.style.display = show ? '' : 'none';
      if (show) hit++;
    }
    if (hit === 0) {
      list.innerHTML = '<li>No updates for <code>'+ (val?String(val).replace(/[&<>]/g,s=>({ "&":"&amp;","<":"&lt;",">":"&gt;" }[s])):'') +'</code>. Try another query.</li>';
    }
  }

  applyFilter(q);

  go.addEventListener('click', function(){
    const v = qInput.value.trim();
    const base = '/updates/';
    const url = v ? (base + '?q=' + encodeURIComponent(v)) : base;
    location.href = url;
  });
  qInput.addEventListener('keydown', function(e){
    if (e.key === 'Enter') go.click();
  });

  // Rewrite item hrefs to include UTM; if linking to updates, preserve vendor q
  for (const a of list.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href) continue;
    if (href.startsWith('/updates/?q=')) {
      a.setAttribute('href', addUTM(href));
    } else {
      a.setAttribute('href', addUTM(href));
    }
  }
})();
</script>
</body>
</html>`;

  const outDir = path.join(ROOT, 'updates');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  console.log('[updates] built');
})();
