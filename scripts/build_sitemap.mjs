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
  try {
    const vendors = await fs.readdir(base, { withFileTypes: true });
    for (const v of vendors) {
      if (!v.isDirectory()) continue;
      const p = path.join(base, v.name, 'timeline.html');
      if (await fileExists(p)) res.push(`/evidence/${v.name}/timeline.html`);
    }
  } catch { /* ignore */ }
  return res;
}

async function main(){
  const urls = new Set(BASE_URLS);
  // Prefer canonical /vendors/ index if present
  if (await fileExists(path.join(PUBLISH_DIR, 'vendors', 'index.html'))) {
    urls.add('/vendors/');
  }
  // Evidence timelines
  for (const u of await listEvidenceDirs()){
    urls.add(u);
  }
  // Reports and RSS if present
  if (await fileExists(path.join(PUBLISH_DIR, 'reports', 'index.html'))) urls.add('/reports/');
  if (await fileExists(path.join(PUBLISH_DIR, 'rss', 'index.html'))) urls.add('/rss/');
  // Root-level pages (index-only)
  for (const page of ['about','intake','who-uses','deal-desk','dashboard']) {
    const p = path.join(PUBLISH_DIR, page, 'index.html');
    if (await fileExists(p)) urls.add(`/${page}/`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...urls].sort().map(u => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}
</urlset>
`;

  const out = path.join(PUBLISH_DIR, 'sitemap.xml');
  await fs.writeFile(out, xml);
  console.log(`Wrote sitemap: ${out} (${urls.size} urls)`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
