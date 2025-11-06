/**
 * Build simple /public/vendors/ index from vendors/*/events.json
 * Safe when empty.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ensureDir, readJSON } from './utils.js';

const ROOT = process.cwd();
const VENDORS_DIR = path.join(ROOT, 'vendors');
const OUT_DIR = path.join(ROOT, 'public', 'vendors');

function htmlPage(title, body){
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
  <link rel="canonical" href="/vendors/"><style>body{{font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial;margin:24px}}</style>
  ${body}`;
}

async function main(){
  await ensureDir(OUT_DIR);
  let entries = [];
  try {
    const items = await fs.readdir(VENDORS_DIR, { withFileTypes: true });
    for (const d of items) {
      if (!d.isDirectory()) continue;
      const slug = d.name;
      const evPath = path.join(VENDORS_DIR, slug, 'events.json');
      const ev = await readJSON(evPath, []);
      entries.push({ slug, count: ev.length });
      const vendorOut = path.join(OUT_DIR, slug);
      await ensureDir(vendorOut);
      await fs.writeFile(path.join(vendorOut, 'index.html'), htmlPage(`Vendor — ${slug}`, `<h1>${slug}</h1><p>${ev.length} events</p>`));
    }
  } catch { /* empty */ }
  const list = entries.map(e => `<li><a href="/vendors/${e.slug}/">${e.slug}</a> — ${e.count} events</li>`).join('') || '<li>No vendors yet</li>';
  await fs.writeFile(path.join(OUT_DIR, 'index.html'), htmlPage('Vendors — CG Alert', `<h1>Vendors</h1><ul>${list}</ul>`));
  console.log('Built vendors index with', entries.length, 'vendors');
}

main().catch(e => { console.error(e); process.exit(1); });
