/**
 * scripts/build_rss.js
 * Build RSS 2.0 feed for CG Alert evidence updates.
 * - No external deps. Node >=16.
 * - Prefers `reports/index.json` if present; falls back to scanning `public/evidence/**/index.html`.
 * - Writes to `public/rss.xml`.
 */
const fs = require('fs');
const path = require('path');

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const REPORTS_INDEX = path.join(process.cwd(), 'reports', 'index.json');
const EVIDENCE_DIR = path.join(PUBLIC_DIR, 'evidence');
const OUT_PATH = path.join(PUBLIC_DIR, 'rss.xml');

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}
function stripTags(html, max=500) {
  if (!html) return '';
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const txt = noScript.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return txt.length > max ? txt.slice(0, max-3) + '...' : txt;
}
function isoToRfc822(dt) {
  const d = new Date(dt);
  return d.toUTCString();
}

function gatherFromReports() {
  const raw = safeRead(REPORTS_INDEX);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    const items = [];
    const arr = j.items || j.evidence || j.changes || [];
    for (const it of arr) {
      const domain = it.domain || it.vendor || it.host || it.site || 'unknown';
      const url = it.url || it.link || it.evidence_url || null;
      const hash = it.hash || it.guid || it.id || null;
      const ts = it.timestamp || it.ts || it.date || it.pubDate || null;
      const title = it.title || `Vendor change: ${domain}`;
      const link = url || (hash && domain && it.yearMonth
        ? `${SITE_ORIGIN}/evidence/${it.yearMonth}/${domain}/${hash}/`
        : `${SITE_ORIGIN}/seo/`);
      const desc = it.snippet || it.summary || it.diff || '';
      items.push({
        title, link, guid: hash || link, pubDate: ts ? isoToRfc822(ts) : null, description: desc, domain
      });
    }
    return items;
  } catch (e) {
    return null;
  }
}

function gatherFromEvidenceScan() {
  if (!exists(EVIDENCE_DIR)) return [];
  const items = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && name === 'index.html') {
        const rel = path.relative(EVIDENCE_DIR, p);
        const parts = rel.split(path.sep);
        if (parts.length >= 4) {
          const [ym, domain, hash] = parts;
          const link = `${SITE_ORIGIN}/evidence/${ym}/${domain}/${hash}/`;
          const html = safeRead(p) || '';
          let desc = '';
          const m = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
          if (m) desc = m[1];
          if (!desc) desc = stripTags(html, 500);
          items.push({
            title: `Vendor change: ${domain}`,
            link, guid: hash || link,
            pubDate: isoToRfc822(fs.statSync(p).mtime),
            description: desc, domain
          });
        }
      }
    }
  }
  walk(EVIDENCE_DIR);
  items.sort((a,b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
  return items;
}

function buildRss(items) {
  const now = new Date();
  const header = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>CG Alert — Vendor Changes</title>
  <link>${SITE_ORIGIN}</link>
  <description>Evidence-backed vendor change alerts (pricing, ToS, DPA, subprocessors, status, etc.).</description>
  <language>en</language>
  <lastBuildDate>${now.toUTCString()}</lastBuildDate>
`;
  const pieces = [header];
  const MAX = Math.min(items.length, 100);
  for (let i = 0; i < MAX; i++) {
    const it = items[i];
    const title = (it.title || 'Vendor change').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const link = it.link || SITE_ORIGIN;
    const guid = (it.guid || link).toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const desc = (it.description || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const pub = it.pubDate ? isoToRfc822(it.pubDate) : new Date().toUTCString();
    pieces.push(`  <item>
    <title>${title}</title>
    <link>${link}</link>
    <guid isPermaLink="false">${guid}</guid>
    <pubDate>${pub}</pubDate>
    <description>${desc}</description>
  </item>
`);
  }
  pieces.push(`</channel>
</rss>
`);
  return pieces.join('');
}

function main() {
  if (!exists(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  let items = gatherFromReports();
  if (!items || !items.length) items = gatherFromEvidenceScan();
  if (!items || !items.length) {
    const placeholder = buildRss([{
      title: 'CG Alert is live',
      link: SITE_ORIGIN + '/seo/',
      guid: 'cg-alert-initial',
      pubDate: new Date().toISOString(),
      description: 'RSS feed will populate as evidence is generated.'
    }]);
    fs.writeFileSync(OUT_PATH, placeholder, 'utf8');
    console.log(`Wrote placeholder RSS (no items found) -> ${OUT_PATH}`);
    return;
  }
  const xml = buildRss(items);
  fs.writeFileSync(OUT_PATH, xml, 'utf8');
  console.log(`Wrote RSS with ${items.length} items -> ${OUT_PATH}`);
}

main();
