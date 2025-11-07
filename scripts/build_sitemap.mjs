import fs from 'fs/promises';
import path from 'path';

const PUBLISH_DIR = process.env.PUBLISH_DIR || '.';
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const BASE_URLS = ['/', '/pricing/', '/reports/', '/evidence/', '/rss/'];

async function fileExists(p){
  try{ await fs.access(p); return true; } catch { return false; }
}

async function listEvidenceDirs(){
  const res = [];
  const base = path.join(PUBLISH_DIR, 'evidence');
  async function walk(dir){
    let ents;
    try { ents = await fs.readdir(dir, {withFileTypes: true}); } catch { return; }
    for(const e of ents){
      const p = path.join(dir, e.name);
      if(e.isDirectory()){
        await walk(p);
        if(await fileExists(path.join(p,'index.html'))){
          const webPath = '/' + path.posix.join('evidence', path.relative(path.join(PUBLISH_DIR,'evidence'), p).split(path.sep).join('/')) + '/';
          res.push(webPath);
        }
      }
    }
  }
  await walk(base);
  return res;
}

async function main(){
  const ev = await listEvidenceDirs();
  const urls = Array.from(new Set([...BASE_URLS, ...ev]));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(u => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}\n</urlset>\n`;
  const out = path.join(PUBLISH_DIR, 'sitemap.xml');
  await fs.writeFile(out, xml);
  console.log(`Wrote sitemap: ${out} (${urls.length} urls)`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
