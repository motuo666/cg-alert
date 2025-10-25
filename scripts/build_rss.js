#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import glob from 'glob';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SRC_DIR = path.join(ROOT, 'evidence');
const OUT_FILE = path.join(ROOT, 'public', 'rss.xml');

const escapeXml = (s='') => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');

const shouldPublishVendor = (v='') => {
  if(!v) return false;
  if(v.startsWith('_')) return false;
  if(v==='acme') return false;
  if(v.startsWith('status.')) return false;
  if(v==='status.domain') return false;
  return true;
};

function loadAll() {
  const files = glob.sync(path.join(SRC_DIR, '**/*.json'));
  const list = [];
  files.forEach(fp => {
    try {
      const d = JSON.parse(fs.readFileSync(fp,'utf8'));
      d.__slug = path.basename(fp).replace(/\.json$/i,'.html');
      d.__vendor = d.vendor;
      list.push(d);
    } catch {}
  });
  list.sort((a,b) => new Date(b.detected_at||0) - new Date(a.detected_at||0));
  return list;
}

function buildRss(items){
  const now = new Date().toUTCString();
  const rssItems = items.slice(0, 60).map(it => {
    const vendor = it.__vendor || '';
    const slug = it.__slug || 'unknown.html';
    const permalink = `https://www.cg-alert.com/evidence/${vendor}/${slug}`;
    const dateStr = (it.detected_at||'').split('T')[0] || '';
    const title = `${vendor} ${it.type||''} (${dateStr})`;
    const pub = new Date(it.detected_at||Date.now()).toUTCString();
    return [
      '<item>',
      `<title>${escapeXml(title)}</title>`,
      `<link>${escapeXml(permalink)}</link>`,
      `<guid isPermaLink="false">${escapeXml(`${vendor}/${slug}`)}</guid>`,
      `<pubDate>${escapeXml(pub)}</pubDate>`,
      '</item>'
    ].join('\n');
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    '<title>CG Alert — Evidence Feed</title>',
    '<link>https://www.cg-alert.com/</link>',
    '<atom:link href="https://www.cg-alert.com/rss.xml" rel="self" type="application/rss+xml"/>',
    '<description>',
    'High-signal vendor change evidence with cryptographic hash, captured from public sources only (Pricing, ToS/MSA, DPA, Subprocessors, Status). Timestamped for Procurement / Legal Ops / Finance audit. Not legal advice.',
    '</description>',
    '<language>en-us</language>',
    `<lastBuildDate>${escapeXml(now)}</lastBuildDate>`,
    rssItems,
    '</channel>',
    '</rss>',
    ''
  ].join('\n');
}

(function main(){
  const all = loadAll();
  const filtered = all.filter(it => shouldPublishVendor(it.vendor));
  const xml = buildRss(filtered);
  fs.writeFileSync(OUT_FILE, xml, 'utf8');
  console.log('✅ rss.xml generated with', filtered.length, 'items');
})();
