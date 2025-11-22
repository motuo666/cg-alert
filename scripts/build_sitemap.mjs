import fs from 'fs/promises';
import path from 'path';

const PUBLISH_DIR = process.env.PUBLISH_DIR || '.';
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const BASE_URLS = ['/', '/pricing/', '/reports/', '/evidence/', '/rss/'];

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listEvidenceDirs() {
  const res = [];
  const base = path.join(PUBLISH_DIR, 'evidence');
  try {
    const vendors = await fs.readdir(base, { withFileTypes: true });
    for (const v of vendors) {
      if (!v.isDirectory()) continue;
      const p = path.join(base, v.name, 'timeline.html');
      if (await fileExists(p)) res.push(`/evidence/${v.name}/timeline.html`);
    }
  } catch {
    // ignore missing evidence dir
  }
  return res;
}

async function getLastmod(urlPath) {
  // Map URL to a file path under PUBLISH_DIR and use its mtime as lastmod.
  let rel;
  if (urlPath === '/') {
    rel = 'index.html';
  } else if (urlPath.endsWith('/')) {
    rel = path.join(urlPath.slice(1), 'index.html');
  } else {
    // e.g. /evidence/vendor/timeline.html
    rel = urlPath.slice(1);
  }
  const full = path.join(PUBLISH_DIR, rel);
  try {
    const stat = await fs.stat(full);
    // Sitemap lastmod can be date-only; keep it simple and stable.
    return stat.mtime.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

async function main() {
  const urls = new Set(BASE_URLS);

  if (await fileExists(path.join(PUBLISH_DIR, 'vendors', 'index.html'))) {
    urls.add('/vendors/');
  }

  for (const u of await listEvidenceDirs()) {
    urls.add(u);
  }

  if (await fileExists(path.join(PUBLISH_DIR, 'reports', 'index.html'))) {
    urls.add('/reports/');
  }
  if (await fileExists(path.join(PUBLISH_DIR, 'rss', 'index.html'))) {
    urls.add('/rss/');
  }

  for (const page of ['about', 'intake', 'who-uses', 'deal-desk', 'dashboard']) {
    const p = path.join(PUBLISH_DIR, page, 'index.html');
    if (await fileExists(p)) urls.add(`/${page}/`);
  }

  const entries = [];
  for (const u of urls) {
    const lastmod = await getLastmod(u);
    entries.push({ url: u, lastmod });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .sort((a, b) => a.url.localeCompare(b.url))
  .map(e => e.lastmod
    ? `  <url><loc>${SITE}${e.url}</loc><lastmod>${e.lastmod}</lastmod></url>`
    : `  <url><loc>${SITE}${e.url}</loc></url>`
  )
  .join('\n')}
</urlset>
`;

  const out = path.join(PUBLISH_DIR, 'sitemap.xml');
  await fs.writeFile(out, xml);
  console.log(`Wrote sitemap: ${out} (${entries.length} urls)`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
