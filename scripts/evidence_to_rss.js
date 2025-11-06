import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const EVD = path.join(ROOT,'evidence');
const RSS_MAIN = path.join(ROOT,'rss','index.xml');
const RSS_ALIAS = path.join(ROOT,'public','reports','rss','index.xml');

function rssHeader(now){
return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>CG Alert — Evidence Feed</title>
<link>https://www.cg-alert.com/</link>
<description>Vendor change evidence updates</description>
<language>en</language>
<lastBuildDate>${now}</lastBuildDate>
`}
const rssFooter = `</channel></rss>`;

function fmtItem(e){
  const title = `${e.vendor} change @ ${new Date(e.ts).toISOString()}`;
  const link = `https://www.cg-alert.com/vendors/${(e.vendor||'unknown').replace(/[^a-z0-9]+/gi,'-')}/`;
  const guid = e.id || `${e.vendor}-${e.sha256}-${e.ts}`;
  return `<item><title>${escapeXml(title)}</title><link>${link}</link><guid isPermaLink="false">${guid}</guid><pubDate>${new Date(e.ts).toUTCString()}</pubDate></item>`;
}
function escapeXml(s){return (s||'').replace(/[<>&'"]/g,c=>({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));}

async function loadEvidence(){
  try{
    const files = (await fs.readdir(EVD)).filter(f=>f.endsWith('.json')).slice(-200);
    const out = [];
    for(const f of files){
      try{
        out.push(JSON.parse(await fs.readFile(path.join(EVD,f),'utf8')));
      }catch{}
    }
    return out.sort((a,b)=> (a.ts||'').localeCompare(b.ts||''));
  }catch{
    return [];
  }
}

async function writeBoth(xml){
  await fs.mkdir(path.dirname(RSS_MAIN),{recursive:true});
  await fs.mkdir(path.dirname(RSS_ALIAS),{recursive:true});
  await fs.writeFile(RSS_MAIN, xml, 'utf8');
  await fs.writeFile(RSS_ALIAS, xml, 'utf8');
}

(async function(){
  const evs = await loadEvidence();
  const now = new Date().toUTCString();
  const xml = rssHeader(now) + evs.map(fmtItem).join('\n') + '\n' + rssFooter;
  await writeBoth(xml);
  console.log('rss items', evs.length);
})().catch(e=>{ console.error(e); process.exit(1); });
