#!/usr/bin/env node
/**
 * seo_inject.js — Idempotent SEO injector
 * 作用：
 *  - 为 vendors/*/index.html 与 updates/index.html 注入：
 *    <title> / <meta name="description"> / <link rel="canonical"> / JSON-LD
 *  - 规范 canonical：去除 UTM 参数（utm_*），统一为无查询串的规范 URL
 *  - 避免重复注入（data-cg-seo="1"）
 *
 * 兼容性：
 *  - 若 evidence/<slug>/ 无文件，dateModified 使用当前时间
 *  - 若 HTML 不含 <head>，则跳过该文件
 *
 * 环境变量：
 *  - SITE_ORIGIN（默认 https://www.cg-alert.com）
 */

const fs = require('fs');
const path = require('path');

const SITE = String(process.env.SITE_ORIGIN || 'https://www.cg-alert.com').replace(/\/+$/,'');
const ROOT = path.join(__dirname, '..');

function escapeAttr(s){
  return String(s || '').replace(/"/g, '&quot;');
}

function stripUtm(urlStr){
  try {
    const u = new URL(urlStr, SITE + '/');
    // 移除所有 utm_* 参数
    const params = u.searchParams;
    const keys = Array.from(params.keys());
    let changed = false;
    for (const k of keys){
      if (/^utm_/i.test(k)){ params.delete(k); changed = true; }
    }
    // 移除空查询串
    u.search = params.toString();
    return u.toString().replace(/\?$/,'');
  } catch {
    // 非法 URL，原样返回
    return urlStr;
  }
}

function canonicalFor(pathname){
  // pathname 以 / 开头，例如 /vendors/okta.com/
  const url = SITE + pathname;
  return stripUtm(url);
}

function safeISO(s){
  if (!s) return new Date().toISOString();
  const t = Date.parse(s);
  if (Number.isNaN(t)) return new Date().toISOString();
  try { return new Date(t).toISOString(); } catch { return new Date().toISOString(); }
}

function newestISO(slug){
  const dir = path.join(ROOT, 'evidence', slug);
  if (!fs.existsSync(dir)) return new Date().toISOString();
  let latest = 0;
  for (const f of fs.readdirSync(dir)){
    if (!/\.json$/i.test(f)) continue;
    const st = fs.statSync(path.join(dir, f));
    if (st.mtimeMs > latest) latest = st.mtimeMs;
  }
  return safeISO(latest ? new Date(latest).toISOString() : null);
}

function vendorHead(slug, lastISO){
  const title = `Vendor ${slug} — Public Change Log & Evidence`;
  const desc  = `Evidence-backed public changes for ${slug}: Pricing, ToS, DPA, Subprocessors, Status.`;
  const canon = canonicalFor(`/vendors/${encodeURIComponent(slug)}/`);
  const ld = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "headline": title,
    "about": ["Pricing","Terms of Service","DPA","Subprocessors","Status"],
    "dateModified": lastISO,
    "mainEntityOfPage": canon,
    "publisher": { "@type": "Organization", "name": "CG Alert", "url": SITE },
    "inLanguage": "en"
  };
  return [
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(desc)}">`,
    `<link rel="canonical" href="${escapeAttr(canon)}">`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`
  ].join('\n');
}

function updatesHead(){
  const title = 'Top Public Changes — CG Alert';
  const desc  = 'Evidence-backed changes on vendors’ public pages (Pricing/ToS/DPA/Subprocessors/Status).';
  const canon = canonicalFor('/updates/');
  return [
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(desc)}">`,
    `<link rel="canonical" href="${escapeAttr(canon)}">`
  ].join('\n');
}

function injectHead(file, head){
  if (!fs.existsSync(file)) return false;
  let html = fs.readFileSync(file, 'utf8');
  if (!/<head[^>]*>/i.test(html)) return false;           // 缺 head，跳过
  if (html.includes('data-cg-seo="1"')) return false;     // 已注入，跳过
  html = html.replace(/<head([^>]*)>/i, (m, a) => `<head${a} data-cg-seo="1">\n${head}\n`);
  fs.writeFileSync(file, html, 'utf8');
  return true;
}

function processVendors(){
  const V = path.join(ROOT, 'vendors');
  if (!fs.existsSync(V)) return;
  for (const d of fs.readdirSync(V, { withFileTypes: true })){
    if (!d.isDirectory()) continue;
    const slug = d.name;
    const idx = path.join(V, slug, 'index.html');
    if (!fs.existsSync(idx)) continue;
    const ok = injectHead(idx, vendorHead(slug, newestISO(slug)));
    if (ok) console.log(`SEO injected: vendors/${slug}/index.html`);
  }
}

function processUpdates(){
  const U = path.join(ROOT, 'updates', 'index.html');
  if (!fs.existsSync(U)) return;
  const ok = injectHead(U, updatesHead());
  if (ok) console.log('SEO injected: updates/index.html');
}

(function main(){
  try {
    processVendors();
    processUpdates();
  } catch (e) {
    console.error('seo_inject error:', e && e.stack || e);
    process.exitCode = 0; // 不阻断主流程
  }
})();
