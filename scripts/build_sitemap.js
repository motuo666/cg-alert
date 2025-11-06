// CJS; builds sitemap.xml under PUBLISH_DIR
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = process.cwd();
const PUB_DIR = path.join(ROOT, process.env.PUBLISH_DIR || 'public');
const SITE = (process.env.SITE_ORIGIN || 'https://www.cg-alert.com').replace(/\/$/, '');

function* walk(dir){
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for(const e of entries){
    const p = path.join(dir, e.name);
    if(e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

(async function(){
  await fs.mkdir(PUB_DIR, { recursive: true });
  const urls = new Set();
  // always include root pages if exist
  const defaults = ['/','/pricing/','/vendors/','/evidence/','/compare-builtwith.html'];
  defaults.forEach(u => urls.add(u));
  // scan html files under publish dir
  for await (const f of walk(PUB_DIR)){
    if(!f.endsWith('.html') && !f.endsWith('.xml')) continue;
    const rel = '/' + path.relative(PUB_DIR, f).replace(/\\/g,'/');
    // normalize index.html -> directory URL
    let url = rel.replace(/index\.html$/,'');
    if(!url.endsWith('.html') && !url.endsWith('.xml') && !url.endsWith('/')) url += '/';
    // do not include non-public asset xml except sitemap itself
    if(rel.includes('/rss/')) continue;
    urls.add(url);
  }
  // ensure sitemap path
  const smPath = path.join(PUB_DIR,'sitemap.xml');
  const now = new Date().toISOString();
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...Array.from(urls).sort().map(u => `  <url><loc>${SITE}${u}</loc><lastmod>${now}</lastmod></url>`),
    '</urlset>'
  ].join('\n');
  await fs.writeFile(smPath, xml, 'utf8');
  console.log('sitemap urls', urls.size, '->', smPath);
})().catch(e=>{ console.error(e); process.exit(1); });
