#!/usr/bin/env node
/**
 * reports_nav_hotfix.js
 * 作用：遍历 /reports/**/index.html，若未包含“Home · Reports”导航，则注入一行导航。
 * 好处：即使构建没跑或 CDN 缓存，仓库内 HTML 也会被直接修补。
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT  = path.join(ROOT, 'reports');

function getOriginFromHTML(html) {
  const m = html.match(/<link\s+rel=["']canonical["']\s+href=["'](https?:\/\/[^"']+)\/reports/i);
  if (m) {
    try { return new URL(m[1]).origin; } catch {}
  }
  return 'https://www.cg-alert.com';
}
function injectNav(html, origin) {
  if (html.includes('>Home</a> · <a href="' + origin + '/reports/')) return html; // 已有
  const nav = `<div class="nav" style="margin:0 0 12px;font-size:14px"><a href="${origin}/">Home</a> · <a href="${origin}/reports/">Reports</a></div>`;
  if (html.includes('<div class="wrap">')) {
    return html.replace('<div class="wrap">', `<div class="wrap">\n${nav}`);
  }
  if (html.includes('<body')) {
    return html.replace(/<body[^>]*>/i, m => `${m}\n<div class="wrap">\n${nav}`);
  }
  // 兜底：直接前置
  return nav + html;
}
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(p));
    else if (e.isFile() && e.name === 'index.html') files.push(p);
  }
  return files;
}

(function main(){
  const pages = walk(OUT);
  let touched = 0;
  for (const file of pages) {
    let html = fs.readFileSync(file, 'utf8');
    const origin = getOriginFromHTML(html);
    const out = injectNav(html, origin);
    if (out !== html) {
      fs.writeFileSync(file, out);
      touched++;
      console.log('patched:', file);
    }
  }
  console.log(`done. patched=${touched}, total=${pages.length}`);
})();
