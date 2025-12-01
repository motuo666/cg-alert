import fs from 'fs/promises';
import path from 'path';

const PUBLISH_DIR = process.env.PUBLISH_DIR || '.';
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';

// Core entrypoints we always consider when present
const BASE_URLS = ['/', '/pricing/', '/reports/', '/evidence/', '/rss/'];

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Evidence timelines (per vendor)
async function listEvidenceDirs() {
  const res = [];
  const base = path.join(PUBLISH_DIR, 'evidence');
  try {
    const vendors = await fs.readdir(base, { withFileTypes: true });
    for (const v of vendors) {
      if (!v.isDirectory()) continue;
      const p = path.join(base, v.name, 'timeline.html');
      if (await fileExists(p)) {
        res.push(`/evidence/${v.name}/timeline.html`);
      }
    }
  } catch {
    // evidence dir might not exist yet in dev
  }
  return res;
}

// Map URL path to file on disk and return YYYY-MM-DD mtime
async function getLastmod(urlPath) {
  let rel;
  if (urlPath === '/') {
    rel = 'index.html';
  } else if (urlPath.endsWith('/')) {
    rel = path.join(urlPath.slice(1), 'index.html');
  } else {
    // e.g. /evidence/vendor/timeline.html or /stories/foo.html
    rel = urlPath.slice(1);
  }
  const full = path.join(PUBLISH_DIR, rel);
  try {
    const stat = await fs.stat(full);
    return stat.mtime.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

async function main() {
  const urls = new Set(BASE_URLS);

  // Vendors index
  if (await fileExists(path.join(PUBLISH_DIR, 'vendors', 'index.html'))) {
    urls.add('/vendors/');
  }

  // Vendor profile pages that actually exist
  try {
    const vendorsDir = path.join(PUBLISH_DIR, 'vendors');
    const entries = await fs.readdir(vendorsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const idx = path.join(vendorsDir, entry.name, 'index.html');
      if (await fileExists(idx)) {
        urls.add(`/vendors/${entry.name}/`);
      }
    }
  } catch {
    // vendors dir may not exist yet
  }

  // Evidence timelines
  for (const u of await listEvidenceDirs()) {
    urls.add(u);
  }

  // Reports root + per-period report index pages
  const reportsRoot = path.join(PUBLISH_DIR, 'reports');
  if (await fileExists(path.join(reportsRoot, 'index.html'))) {
    urls.add('/reports/');
  }
  try {
    const entries = await fs.readdir(reportsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const idx = path.join(reportsRoot, entry.name, 'index.html');
      if (await fileExists(idx)) {
        urls.add(`/reports/${entry.name}/`);
      }
    }
  } catch {
    // reports dir may not exist yet
  }

  // RSS index
  if (await fileExists(path.join(PUBLISH_DIR, 'rss', 'index.html'))) {
    urls.add('/rss/');
  }

  // Top-level marketing / legal pages backed by index.html
  const staticPages = [
    'about',
    'intake',
    'who-uses',
    'deal-desk',
    'dashboard',
    'seo',
    'faq',
    'use-cases',
    'enterprise',
    'terms',
    'privacy',
    'thank-you',
    'stories',
  ];
  for (const page of staticPages) {
    const p = path.join(PUBLISH_DIR, page, 'index.html');
    if (await fileExists(p)) {
      urls.add(`/${page}/`);
    }
  }

  // Individual story articles under /stories/
  try {
    const storiesDir = path.join(PUBLISH_DIR, 'stories');
    const entries = await fs.readdir(storiesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      if (!entry.name.endsWith('.html')) continue;
      if (entry.name === 'index.html') continue;
      urls.add(`/stories/${entry.name}`);
    }
  } catch {
    // stories dir may not exist yet
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
