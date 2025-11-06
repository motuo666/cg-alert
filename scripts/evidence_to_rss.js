const { fs, path, slugify, readJSON } = require('./utils.js');
const PUB = path.join(process.cwd(), process.env.PUBLISH_DIR || 'public');
const EVD = path.join(process.cwd(), 'evidence');
const SITE = (process.env.SITE_ORIGIN || 'https://www.cg-alert.com').replace(/\/$/, '');

function itemXML(e){
  const v = slugify(e.vendor);
  const guid = e.sha256 || e.id || `${v}-${e.ts}`;
  const link = `${SITE}/evidence/${v}/${(e.id||e.sha256||'').toString().slice(0,16)}.html`;
  return `  <item>
    <title><![CDATA[${e.vendor} change]]></title>
    <link>${link}</link>
    <guid>${guid}</guid>
    <pubDate>${new Date(e.ts||Date.now()).toUTCString()}</pubDate>
    <description><![CDATA[${(e.snippet||'').slice(0,500)}]]></description>
  </item>`;
}

(async function(){
  await fs.mkdir(path.join(PUB,'rss'),{recursive:true});
  const files = (await fs.readdir(EVD)).filter(f=>f.endsWith('.json'));
  const evs = [];
  for(const f of files){
    const e = await readJSON(path.join(EVD,f), null);
    if(e && e.vendor && (e.sha256||e.id)) evs.push(e);
  }
  evs.sort((a,b)=> String(b.ts||'').localeCompare(String(a.ts||'')));
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '<channel>',
    `<title>CG Alert — Evidence feed</title>`,
    `<link>${SITE}/rss/</link>`,
    `<description>Timestamped vendor change evidence</description>`,
    ...evs.slice(0,200).map(itemXML),
    '</channel>',
    '</rss>'].join('\n');
  await fs.writeFile(path.join(PUB,'rss','index.xml'), xml, 'utf8');
  console.log('rss items', evs.length);
})().catch(e=>{ console.error(e); process.exit(1); });
