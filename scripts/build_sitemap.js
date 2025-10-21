import fs from 'fs';
import path from 'path';
import { ensureDir } from './util.js';

const ROOT = process.cwd();
const PUB = path.join(ROOT, 'public');
const SEO = path.join(PUB, 'seo');
ensureDir(PUB);

function collect(dir, out=[]) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir,{withFileTypes:true})) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) collect(p, out);
    else if (ent.isFile() && ent.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const files = collect(SEO);
const origin = process.env.SITE_ORIGIN || 'https://example.com';
const urls = files.map(f => `<url><loc>${origin}${f.replace(PUB,'').replace(/\\\\/g,'/')}</loc></url>`);

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

fs.writeFileSync(path.join(PUB,'sitemap.xml'), xml, 'utf-8');
console.log(`Sitemap(${files.length}) → public/sitemap.xml`);
