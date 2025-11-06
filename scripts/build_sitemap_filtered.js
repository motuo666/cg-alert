/**
 * Build a simple sitemap.xml consolidating top-level pages and vendor pages.
 * - Excludes /vendors/_seed/* and any path containing '/_/'
 * - Uses SITE_ORIGIN if provided
 * - Writes to PUBLISH_DIR/sitemap.xml
 */
const fs = require('fs');
const path = require('path');

const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const PUB = process.env.PUBLISH_DIR || '.';

function walk(dir, acc=[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      acc = walk(p, acc);
      continue;
    }
    acc.push(p);
  }
  return acc;
}

function htmlOrXml(p) {
  return p.endsWith('.html') || p.endsWith('.xml');
}

function toUrl(p) {
  let u = p.replace(/^\.\/?/, '').replace(/index\.html$/, '').replace(/\\/g,'/');
  if (!u.startsWith('/')) u = '/' + u;
  return ORIGIN + u;
}

function shouldInclude(p) {
  if (!htmlOrXml(p)) return false;
  if (p.includes('/vendors/_')) return false; // exclude seeds
  if (p.includes('/_/')) return false; // exclude hidden
  return true;
}

function build() {
  const files = walk(PUB).filter(shouldInclude);
  const urls = Array.from(new Set(files.map(toUrl))).sort();
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    .concat(urls.map(u => `  <url><loc>${u}</loc></url>`))
    .concat(['</urlset>']).join('\n');
  fs.writeFileSync(path.join(PUB, 'sitemap.xml'), xml);
  console.log('sitemap.xml written with', urls.length, 'urls');
}

build();
