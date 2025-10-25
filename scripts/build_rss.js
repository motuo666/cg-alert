#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const EVIDENCE_DIR = path.join(process.cwd(), 'evidence');
const OUT_PATH = path.join(process.cwd(), 'public', 'rss.xml');

function walkEvidence() {
  const out = [];
  if (!fs.existsSync(EVIDENCE_DIR)) return out;
  for (const vendor of fs.readdirSync(EVIDENCE_DIR)) {
    const vDir = path.join(EVIDENCE_DIR, vendor);
    if (!fs.statSync(vDir).isDirectory()) continue;
    for (const f of fs.readdirSync(vDir)) {
      if (!f.endsWith('.json')) continue;
      const filePath = path.join(vDir, f);
      let data;
      try {
        data = JSON.parse(fs.readFileSync(filePath,'utf8'));
      } catch {
        continue;
      }
      const ts = Date.parse(data.detected_at || data.timestamp || Date.now());
      const baseName = f.replace(/\.json$/,'');
      // We'll link to .html evidence card since it's human-friendly.
      const humanHref = `${ORIGIN}/evidence/${encodeURIComponent(vendor)}/${encodeURIComponent(baseName)}.html`;
      out.push({
        vendor,
        baseName,
        humanHref,
        when: new Date(ts),
        kind: data.type || data.kind || 'change'
      });
    }
  }
  // newest first
  out.sort((a,b)=>b.when - a.when);
  return out;
}

function esc(s){
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;');
}

function build() {
  const items = walkEvidence();

  const head = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>CG Alert — Evidence Feed</title>
    <link>${ORIGIN}/</link>
    <atom:link href="${ORIGIN}/rss.xml" rel="self" type="application/rss+xml"/>
    <description>High-signal vendor change evidence with cryptographic hash, captured from public sources only (Pricing, ToS/MSA, DPA, Subprocessors, Status). Timestamped for Procurement / Legal Ops / Finance audit. Not legal advice.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`;

  const body = items.slice(0,100).map(it => {
    const title = `${it.vendor} ${it.kind} (${it.when.toISOString().slice(0,10)})`;
    return [
      '<item>',
      `  <title>${esc(title)}</title>`,
      `  <link>${esc(it.humanHref)}</link>`,
      `  <guid isPermaLink="false">${esc(it.vendor + '/' + it.baseName + '.html')}</guid>`,
      `  <pubDate>${it.when.toUTCString()}</pubDate>`,
      '</item>'
    ].join('\n');
  }).join('\n');

  const tail = `
  </channel>
</rss>
`;

  fs.writeFileSync(OUT_PATH, head+'\n'+body+tail, 'utf8');
  console.log('rss built:', OUT_PATH, 'items=', items.length);
}

build();
