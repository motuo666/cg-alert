// scripts/poller.js (CommonJS)
const fs = require('fs');
const path = require('path');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const { findFirst, readCSVGuess, ensureDir, log } = require('./utils.js');

const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const vendorsPath = findFirst(['vendors/vendors.csv','data/vendors.csv','vendors.csv']);

let vendors = ['vendorx.com/pricing'];
if(vendorsPath){
  try{
    const rows = readCSVGuess(vendorsPath);
    const cols = Object.keys(rows[0]||{}).map(s=>s.toLowerCase());
    const key = cols.includes('url') ? 'url' : (cols[0]||'url');
    vendors = rows.map(r => String(r[key]||'').replace(/^https?:\/\//,'')).filter(Boolean);
    log('loaded vendors:', vendors.length, 'from', vendorsPath);
  }catch(e){ log('vendors.csv parse failed, fallback:', e.message); }
}

const OUT_DIR = path.join(process.cwd(), 'reports');
const RSS = path.join(OUT_DIR, 'rss.xml');

function ensureRss(){
  ensureDir(OUT_DIR);
  if(!fs.existsSync(RSS)){
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:cg="https://www.cg-alert.com/ns" xml-stylesheet="type=text/xsl href='/reports/rss.xsl'">
  <channel>
    <title>CG Alert — Reports</title>
    <link>${SITE}/reports/</link>
    <description>Evidence-backed vendor changes</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  </channel>
</rss>`;
    fs.writeFileSync(RSS, xml);
  }
}

function appendItem({title, summary, link, sourceUrl, sha}){
  const parser = new XMLParser({ ignoreAttributes:false, attributeNamePrefix:'@_' });
  const builder = new XMLBuilder({ ignoreAttributes:false, attributeNamePrefix:'@_' });
  const doc = parser.parse(fs.readFileSync(RSS,'utf8'));
  const ch = doc.rss.channel;
  const item = {
    title, description: `<![CDATA[${summary}]]>`, link, pubDate: new Date().toUTCString(),
    'cg:sourceUrl': sourceUrl, 'cg:sha256': sha || 'n/a'
  };
  ch.item = Array.isArray(ch.item) ? [...ch.item, item] : (ch.item ? [ch.item, item] : [item]);
  ch.lastBuildDate = new Date().toUTCString();
  fs.writeFileSync(RSS, builder.build(doc));
}

function shaDemo(input){
  return require('crypto').createHash('sha256').update(String(input)).digest('hex');
}

function main(){
  ensureRss();
  const n = Math.max(1, vendors.length);
  vendors.slice(0, n).forEach(v => {
    appendItem({
      title: `Change detected @ ${v}`,
      summary: `Potential update at ${v}. Verify & escalate if material.`,
      link: `${SITE}/reports/`,
      sourceUrl: `https://${v}`,
      sha: shaDemo(v + Date.now())
    });
  });
  log('poller finished. items appended:', vendors.length);
}
main();
