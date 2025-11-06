import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const PUB = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'public', 'sitemap.xml');
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';

async function collect(dir){
  const out=[];
  const items = await fs.readdir(dir, { withFileTypes: true });
  for(const it of items){
    if(it.name.startsWith('.')) continue;
    const full = path.join(dir, it.name);
    if(it.isDirectory()){
      out.push(...await collect(full));
    }else if(it.isFile() && it.name.endsWith('.html')){
      const rel = full.slice(PUB.length).replace(/\\/g,'/');
      out.push(rel);
    }
  }
  return out;
}

(async function(){
  const pages = await collect(PUB);
  const urls = pages.map(p=>`  <url><loc>${ORIGIN}${p}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  await fs.writeFile(OUT, xml, 'utf8');
  console.log('sitemap pages', pages.length);
})().catch(e=>{ console.error(e); process.exit(1); });
