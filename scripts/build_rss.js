'use strict';
// scripts/build_rss.js (hotfix, no block comments/backticks)
// Builds a minimal RSS 2.0 feed at public/rss.xml using either reports/index.json
// or scanning public/evidence/**/index.html. Node >=14, no external deps.

const fs = require('fs');
const path = require('path');

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const REPORTS_INDEX = path.join(process.cwd(), 'reports', 'index.json');
const EVIDENCE_DIR = path.join(PUBLIC_DIR, 'evidence');
const OUT_PATH = path.join(PUBLIC_DIR, 'rss.xml');

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}
function exists(p) {
  try { fs.accessSync(p); return true; } catch (e) { return false; }
}
function stripTags(html, max) {
  if (!html) return '';
  if (!max) max = 500;
  var s = html.replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
  if (s.length > max) s = s.slice(0, max - 3) + '...';
  return s;
}
function toRfc822(dt) {
  var d = new Date(dt);
  if (isNaN(d.getTime())) d = new Date();
  return d.toUTCString();
}

function gatherFromReports() {
  var raw = safeRead(REPORTS_INDEX);
  if (!raw) return null;
  try {
    var j = JSON.parse(raw);
    var src = j.items || j.evidence || j.changes || [];
    var items = [];
    for (var i = 0; i < src.length; i++) {
      var it = src[i] || {};
      var domain = it.domain || it.vendor || it.host || it.site || 'unknown';
      var url = it.url || it.link || it.evidence_url || null;
      var hash = it.hash || it.guid || it.id || null;
      var ts = it.timestamp || it.ts || it.date || it.pubDate || null;
      var title = it.title || ('Vendor change: ' + domain);
      var link = url;
      if (!link && hash && domain && it.yearMonth) {
        link = SITE_ORIGIN.replace(/\/+$/,'') + '/evidence/' + it.yearMonth + '/' + domain + '/' + hash + '/';
      }
      if (!link) link = SITE_ORIGIN.replace(/\/+$/,'') + '/seo/';
      var desc = it.snippet || it.summary || it.diff || '';
      items.push({
        title: title,
        link: link,
        guid: (hash || link),
        pubDate: ts ? toRfc822(ts) : null,
        description: desc,
        domain: domain
      });
    }
    return items;
  } catch (e) {
    return null;
  }
}

function walk(dir, cb) {
  var names = fs.readdirSync(dir);
  for (var i = 0; i < names.length; i++) {
    var p = path.join(dir, names[i]);
    var st = fs.statSync(p);
    if (st.isDirectory()) walk(p, cb);
    else if (st.isFile()) cb(p, st);
  }
}

function gatherFromEvidenceScan() {
  if (!exists(EVIDENCE_DIR)) return [];
  var items = [];
  walk(EVIDENCE_DIR, function(p, st) {
    if (path.basename(p) !== 'index.html') return;
    var rel = path.relative(EVIDENCE_DIR, p); // YYYY-MM/domain/hash/index.html
    var parts = rel.split(path.sep);
    if (parts.length < 4) return;
    var ym = parts[0];
    var domain = parts[1];
    var hash = parts[2];
    var link = SITE_ORIGIN.replace(/\/+$/,'') + '/evidence/' + ym + '/' + domain + '/' + hash + '/';
    var html = safeRead(p) || '';
    var desc = '';
    var m = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    if (m) desc = m[1];
    if (!desc) desc = stripTags(html, 500);
    items.push({
      title: 'Vendor change: ' + domain,
      link: link,
      guid: (hash || link),
      pubDate: toRfc822(st.mtime),
      description: desc,
      domain: domain
    });
  });
  items.sort(function(a,b){ return new Date(b.pubDate||0) - new Date(a.pubDate||0); });
  return items;
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildRss(items) {
  var now = new Date();
  var out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<rss version="2.0">');
  out.push('<channel>');
  out.push('  <title>CG Alert — Vendor Changes</title>');
  out.push('  <link>' + SITE_ORIGIN + '</link>');
  out.push('  <description>Evidence-backed vendor change alerts (pricing, ToS, DPA, subprocessors, status, etc.).</description>');
  out.push('  <language>en</language>');
  out.push('  <lastBuildDate>' + now.toUTCString() + '</lastBuildDate>');
  var MAX = items.length < 100 ? items.length : 100;
  for (var i = 0; i < MAX; i++) {
    var it = items[i] || {};
    var title = esc(it.title || 'Vendor change');
    var link = it.link || SITE_ORIGIN;
    var guid = esc((it.guid || link).toString());
    var desc = esc(it.description || '');
    var pub = toRfc822(it.pubDate || now.toISOString());
    out.push('  <item>');
    out.push('    <title>' + title + '</title>');
    out.push('    <link>' + link + '</link>');
    out.push('    <guid isPermaLink="false">' + guid + '</guid>');
    out.push('    <pubDate>' + pub + '</pubDate>');
    out.push('    <description>' + desc + '</description>');
    out.push('  </item>');
  }
  out.push('</channel>');
  out.push('</rss>');
  return out.join('\n');
}

function main() {
  if (!exists(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  var items = gatherFromReports();
  if (!items || !items.length) items = gatherFromEvidenceScan();
  if (!items || !items.length) {
    items = [{
      title: 'CG Alert is live',
      link: SITE_ORIGIN.replace(/\/+$/,'') + '/seo/',
      guid: 'cg-alert-initial',
      pubDate: new Date().toISOString(),
      description: 'RSS feed will populate as evidence is generated.'
    }];
  }
  var xml = buildRss(items);
  fs.writeFileSync(OUT_PATH, xml, 'utf8');
  console.log('Wrote RSS with ' + items.length + ' items -> ' + OUT_PATH);
}

main();
