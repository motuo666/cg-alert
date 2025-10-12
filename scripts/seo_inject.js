#!/usr/bin/env node
// seo_inject.js — 给 vendors/*/index.html 与 updates/index.html 注入 SEO/JSON-LD
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://www.cg-alert.com';

function inject(file, headFrag){
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('data-cg-seo="1"')) return; // 已注入
  html = html.replace(/<head([^>]*)>/i, (m, a) => `<head$1 data-cg-seo="1">\n${headFrag}\n`);
  fs.writeFileSync(file, html, 'utf8');
}

function vendorHead(slug, lastmodISO){
  const title = `Vendor ${slug} — Public Change Log & Evidence`;
  const desc  = `Evidence-backed public changes for ${slug}: Pricing, ToS, DPA, Subprocessors, Status.`;
  const canon = `${SITE}/vendors/${encodeURIComponent(slug)}/`;
  const ld = {
    "@context":"https://schema.org",
    "@type":"TechArticle",
    "headline": title,
    "about": ["Pricing","Terms of Service","DPA","Subprocessors","Status"],
    "dateModified": lastmodISO,
    "mainEntityOfPage": canon,
    "publisher": {"@type":"Organization","name":"CG Alert","url":SITE},
    "inLanguage":"en"
  };
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}">`,
    `<link rel="canonical" href="${canon}">`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`
  ].join('\n');
}

function updatesHead(){
  const title = 'Top Public Changes — CG Alert';
  const desc  = 'Evidence-backed changes on vendors’ public pages (Pricing/ToS/DPA/Subprocessors/Status).';
  const canon = `${SITE}/updates/`;
  const ld = {
    "@context":"https://schema.org",
    "@type":"CollectionPage",
    "name": title,
    "url": canon,
    "about":["Pricing","Terms of Service","DPA","Subprocessors","Status"],
    "inLanguage":"en",
    "publisher":{"@type":"Organization","name":"CG Alert","url":SITE}
  };
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}">`,
    `<link rel="canonical" href="${canon}">`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`
  ].join('\n');
}

function newestEvidenceISO(slug){
  const dir = path.join(ROOT, 'evidence', slug);
  if (!fs.existsSync(dir)) return new Date().toISOString();
  let t = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.json$/i.test(f)) continue;
    const st = fs.statSync(path.join(dir,f));
    if (st.mtimeMs > t) t = st.mtimeMs;
  }
  return new Date(t || Date.now()).toISOString();
}

(function main(){
  // vendors
  const V = path.join(ROOT, 'vendors');
  if (fs.existsSync(V)) {
    for (const d of fs.readdirSync(V, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const slug = d.name;
      if (slug === 'acme' || slug.startsWith('_')) continue;
      const idx = path.join(V, slug, 'index.html');
      if (!fs.existsSync(idx)) continue;
      const lastmod = newestEvidenceISO(slug);
      inject(idx, vendorHead(slug, lastmod));
      console.log(`SEO injected: vendors/${slug}/index.html`);
    }
  }
  // updates
  const U = path.join(ROOT, 'updates', 'index.html');
  if (fs.existsSync(U)) {
    inject(U, updatesHead());
    console.log('SEO injected: updates/index.html');
  }
})();
