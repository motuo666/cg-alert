import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const EVD = path.join(ROOT,'evidence');
const RSS = path.join(ROOT,'rss','index.xml');

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
  const link = `https://www.cg-alert.com/vendors/${e.vendor.replace(/[^a-z0-9]+/gi,'-')}/`;
  return `<item><title>${escapeXml(title)}</title><link>${link}</link><guid isPermaLink="false">${e.id}</guid><pubDate>${new Date(e.ts).toUTCString()}</pubDate></item>`;
}
function escapeXml(s){return s.replace(/[<>&'"]/g,c=>({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));}

async function main(){
  const files = (await fs.readdir(EVD)).filter(f=>f.endsWith('.json')).slice(-100);
  const evs = [];
  for(const f of files){
    try{
      const e = JSON.parse(await fs.readFile(path.join(EVD,f),'utf8'));
      evs.push(e);
    }catch{}
  }
  evs.sort((a,b)=> (a.ts||'').localeCompare(b.ts||''));
  const now = new Date().toUTCString();
  let xml = rssHeader(now) + evs.map(fmtItem).join('\n') + '\n' + rssFooter;
  await fs.mkdir(path.dirname(RSS),{recursive:true});
  await fs.writeFile(RSS, xml, 'utf8');
  console.log('rss items', evs.length);
}
main().catch(e=>{ console.error(e); process.exit(1); });
