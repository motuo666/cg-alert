'use strict';
const fs = require('fs');
const path = require('path');
const RAW = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
let ORIGIN = RAW;
try { ORIGIN = new URL(RAW).origin; } catch (e) { ORIGIN = 'https://www.cg-alert.com'; }

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const REPORTS_INDEX = path.join(process.cwd(), 'reports', 'index.json');
const EVIDENCE_DIR = path.join(PUBLIC_DIR, 'evidence');
const OUT_PATH = path.join(PUBLIC_DIR, 'rss.xml');

function safeRead(p){ try { return fs.readFileSync(p,'utf8'); } catch { return null; } }

function buildRss(items){
  const now = new Date();
  const head = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    '  <title>CG Alert — Evidence Feed</title>',
    '  <link>' + ORIGIN + '</link>',
    '  <atom:link href="' + ORIGIN + '/rss.xml" rel="self" type="application/rss+xml"/>',
    '  <description>Vendor change evidence.</description>',
    '  <language>en-us</language>',
    '  <lastBuildDate>' + now.toUTCString() + '</lastBuildDate>'
  ].join('\n');
  const tail = '\n</channel>\n</rss>\n';
  let body = '';
  const MAX = Math.min(items.length, 100);
  for (let i=0;i<MAX;i++){
    const it = items[i] || {};
    const title = (it.title||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const link = (''+(it.link||'')).replace(/&/g,'&amp;');
    const guid = (it.guid||link||('id-'+i)).replace(/&/g,'&amp;');
    const pubDate = new Date(it.pubDate || Date.now()).toUTCString();
    const desc = (it.description||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
    body += [
      '<item>',
      '  <title>'+title+'</title>',
      '  <link>'+link+'</link>',
      '  <guid isPermaLink="false">'+guid+'</guid>',
      '  <pubDate>'+pubDate+'</pubDate>',
      '  <description>'+desc+'</description>',
      '</item>'
    ].join('\n') + '\n';
  }
  return head + '\n' + body + tail;
}

function collectFromReportsIndex(){
  const txt = safeRead(REPORTS_INDEX);
  if (!txt) return [];
  try {
    const data = JSON.parse(txt);
    // No items here; this is only channel metadata
    return [];
  } catch { return []; }
}

function collectFromEvidence(){
  // Minimal: list recent json files under public/evidence/** and convert to items
  const items=[];
  function walk(dir){
    for (const name of fs.readdirSync(dir)){
      const p = path.join(dir,name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && /\.json$/i.test(name)){
        // Link directly to the json evidence URL
        const rel = p.split(path.sep).slice(p.split(path.sep).indexOf('public')+1).join('/');
        items.push({ title: name.replace(/\.json$/,''), link: ORIGIN + '/' + rel.replace(/^public\//,''), guid: rel, pubDate: st.mtime.toISOString() });
      }
    }
  }
  const dir = EVIDENCE_DIR;
  if (fs.existsSync(dir)) walk(dir);
  // sort desc by date
  items.sort((a,b)=> new Date(b.pubDate) - new Date(a.pubDate));
  return items;
}

function main(){
  let items = collectFromEvidence();
  const xml = buildRss(items);
  fs.writeFileSync(OUT_PATH, xml, 'utf8');
  console.log('RSS written to', OUT_PATH, 'with', items.length, 'items; origin =', ORIGIN);
}
main();
