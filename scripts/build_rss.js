#!/usr/bin/env node

// CG Alert RSS builder (final harden version for production)
// - CommonJS (works in GitHub Actions Node 20 without "type": "module")
// - Dedupe per (vendor,type,day)
// - Adds human-readable <description>
// - Skips internal/test vendors
// - Tolerates missing detected_at so feed never looks broken

const fs = require('fs');
const path = require('path');

// repo root
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'evidence');
const OUT_FILE = path.join(ROOT, 'public', 'rss.xml');

// escape XML text safely
function escapeXml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
    // NOTE: single quote (') does not need escaping in element text nodes
}

// we don't want to publish junk / internal fixtures
function shouldPublishVendor(v = '') {
  if (!v) return false;
  if (v.startsWith('_')) return false;          // internal / scratch
  if (v === 'acme') return false;               // demo placeholder
  if (v.startsWith('status.')) return false;    // synthetic status domains
  if (v === 'status.domain') return false;      // explicit synthetic
  return true;
}

// walk evidence/ recursively and collect *.json
function collectEvidenceJsonFiles(rootDir) {
  const out = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir);
    for (const name of entries) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile() && name.toLowerCase().endsWith('.json')) {
        out.push(full);
      }
    }
  }

  walk(rootDir);
  return out;
}

// load all evidence objects, newest first
function loadAll() {
  const files = collectEvidenceJsonFiles(SRC_DIR);
  const list = [];

  for (const fp of files) {
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      const obj = JSON.parse(raw);

      // store convenience fields we need later
      obj.__slug   = path.basename(fp).replace(/\.json$/i, '.html');
      obj.__vendor = obj.vendor;

      list.push(obj);
    } catch (err) {
      // broken/half-written JSON shouldn't kill the job
    }
  }

  // sort newest -> oldest by detected_at
  list.sort((a, b) => {
    const at = new Date(a.detected_at || 0).getTime();
    const bt = new Date(b.detected_at || 0).getTime();
    // bt - at gives descending (newest first)
    return bt - at;
  });

  return list;
}

// build RSS XML with dedupe and human descriptions
function buildRss(items) {
  const nowRfc2822 = new Date().toUTCString();
  const seen = new Set();
  const rssItemsArr = [];

  for (const it of items) {
    const vendor = it.__vendor || '';
    if (!vendor) continue;

    // pick a safe timestamp for this item
    // if detected_at missing, fall back to "now"
    const detectedRaw =
      it.detected_at ||
      it.timestamp ||
      it.last_seen ||
      new Date().toISOString();

    const dateStr = (detectedRaw || '').split('T')[0] || '';
    const pubDateRfc2822 = new Date(detectedRaw || Date.now()).toUTCString();

    const typ    = it.type || 'Change';
    const impact = it.impact || it.severity || 'n/a';

    // only keep one item per vendor / type / day so we don't spam
    const dedupeKey = `${vendor}::${typ}::${dateStr}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const slug = it.__slug || 'unknown.html';
    const permalink = `https://www.cg-alert.com/evidence/${vendor}/${slug}`;

    const title = dateStr
      ? `${vendor} ${typ} (${dateStr})`
      : `${vendor} ${typ}`;

    // short human summary that makes us look like a leverage product,
    // not just a scraper.
    const humanDesc =
      `${vendor} ${typ} change observed ${dateStr || 'recently'}. ` +
      `Impact: ${impact}. ` +
      `Evidence captured (timestamp, source URL, cryptographic hash) ` +
      `for Procurement / Legal Ops / Finance leverage.`;

    const oneItemXml = [
      '<item>',
      `<title>${escapeXml(title)}</title>`,
      `<link>${escapeXml(permalink)}</link>`,
      `<guid isPermaLink="false">${escapeXml(vendor + '/' + slug)}</guid>`,
      `<pubDate>${escapeXml(pubDateRfc2822)}</pubDate>`,
      `<description>${escapeXml(humanDesc)}</description>`,
      '</item>'
    ].join('\n');

    rssItemsArr.push(oneItemXml);

    // cap feed so it doesn't turn into a 5MB monster
    if (rssItemsArr.length >= 60) break;
  }

  const channelDesc =
    'High-signal vendor change evidence with timestamp, source URL, and cryptographic hash for Procurement / Legal Ops / Finance audit. Not legal advice.';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    '<title>CG Alert — Evidence Feed</title>',
    '<link>https://www.cg-alert.com/</link>',
    '<atom:link href="https://www.cg-alert.com/rss.xml" rel="self" type="application/rss+xml"/>',
    '<description>',
    escapeXml(channelDesc),
    '</description>',
    '<language>en-us</language>',
    `<lastBuildDate>${escapeXml(nowRfc2822)}</lastBuildDate>`,
    rssItemsArr.join('\n'),
    '</channel>',
    '</rss>',
    ''
  ].join('\n');
}

// main
(function main() {
  // 1. load raw evidence
  const all = loadAll();

  // 2. filter out internal/test vendors
  const filtered = all.filter(it => shouldPublishVendor(it.vendor));

  // 3. build rss xml
  const xml = buildRss(filtered);

  // 4. write rss.xml to public/
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, xml, 'utf8');

  // log for GitHub Actions so we can debug on run output
  const uniqueCount = (xml.match(/<item>/g) || []).length;
  console.log(
    '✅ rss.xml generated:',
    filtered.length, 'source objects,',
    uniqueCount, 'unique feed items'
  );
})();
