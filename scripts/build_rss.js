#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const RAW = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
let ORIGIN;
try { ORIGIN = new URL(RAW).origin; }
catch { ORIGIN = 'https://www.cg-alert.com'; }

const PUBLIC_DIR     = path.join(process.cwd(), 'public');
const EVIDENCE_FEED  = path.join(PUBLIC_DIR, 'evidence');
const OUT_PATH       = path.join(PUBLIC_DIR, 'rss.xml');

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      out.push(...walk(p));
    } else if (st.isFile()) {
      out.push(p);
    }
  }
  return out;
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;');
}

function build() {
  const items = [];
  for (const p of walk(EVIDENCE_FEED)) {
    if (!p.endsWith('.json')) continue;
    const rel = path.relative(PUBLIC_DIR, p).replace(/\\/g,'/');
    let data;
    try {
      data = JSON.parse(fs.readFileSync(p,'utf8'));
    } catch {
      continue;
    }
    const ts = Date.parse(data.detected_at || data.timestamp || Date.now());
    items.push({
      date: new Date(ts),
      title: `${data.vendor || 'vendor'} ${data.type || data.kind || 'change'} (${data.kind || 'update'})`,
      link: ORIGIN + '/' + rel,
      guid: rel
    });
  }

  // newest first
  items.sort((a,b)=>b.date - a.date);

  const head = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>CG Alert — Evidence Feed</title>
    <link>${ORIGIN}/</link>
    <atom:link href="${ORIGIN}/rss.xml" rel="self" type="application/rss+xml"/>
    <description>High-signal vendor change evidence with cryptographic hash, captured from public sources only.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`;

  const body = items.slice(0,100).map(it => [
    '<item>',
    `  <title>${esc(it.title)}</title>`,
    `  <link>${esc(it.link)}</link>`,
    `  <guid isPermaLink="false">${esc(it.guid)}</guid>`,
    `  <pubDate>${it.date.toUTCString()}</pubDate>`,
    '</item>'
  ].join('\n')).join('\n');

  const tail = '\n  </channel>\n</rss>\n';

  fs.writeFileSync(OUT_PATH, head+'\n'+body+tail, 'utf8');
  console.log('rss built:', OUT_PATH, 'items=', items.length, 'origin=', ORIGIN);
}

build();
