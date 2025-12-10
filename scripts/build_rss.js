#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ORIGIN = (process.env.SITE_ORIGIN || 'https://www.cg-alert.com').replace(/\/+$/, '');

function readFeedItems() {
  const feedPath = path.join('reports', 'feed.json');
  if (!fs.existsSync(feedPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(feedPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items) || data.items.length === 0) {
      return null;
    }
    const items = data.items.map((it) => {
      const url = it.url || '';
      let href = url;
      if (!/^https?:\/\//i.test(href)) {
        const suffix = url.startsWith('/') ? url : ('/' + url);
        href = ORIGIN + suffix;
      }
      let pubDate = null;
      const srcDate = it.date || it.generated_at || data.generated_at;
      if (srcDate) {
        const d = new Date(srcDate);
        if (!isNaN(d.getTime())) {
          pubDate = d.toUTCString();
        }
      }
      return {
        title: (it.vendor || 'Vendor') + ' changes',
        link: href,
        pubDate,
      };
    });
    // newest first, guard against missing pubDate
    items.sort((a, b) => {
      const ta = a.pubDate ? Date.parse(a.pubDate) : 0;
      const tb = b.pubDate ? Date.parse(b.pubDate) : 0;
      return tb - ta;
    });
    return items;
  } catch (err) {
    console.error('build_rss: failed to read reports/feed.json:', err.message);
    return null;
  }
}

function* walkReportsLegacy() {
  const rep = 'reports';
  if (!fs.existsSync(rep)) return;
  for (const ym of fs.readdirSync(rep)) {
    const p = path.join(rep, ym);
    if (!/^\d{4}-\d{2}$/.test(ym) || !fs.statSync(p).isDirectory()) continue;
    for (const v of fs.readdirSync(p)) {
      const idx = path.join(p, v, 'index.html');
      if (fs.existsSync(idx)) {
        const stat = fs.statSync(idx);
        yield {
          vendor: v,
          ym,
          mtime: stat.mtime,
          url: ORIGIN + `/reports/${ym}/${v}/`,
        };
      }
    }
  }
}

function buildFromLegacy() {
  const all = Array.from(walkReportsLegacy())
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 100);
  return all.map((i) => ({
    title: `${i.vendor} changes — ${i.ym}`,
    link: i.url,
    pubDate: i.mtime.toUTCString(),
  }));
}

function buildItems() {
  const fromFeed = readFeedItems();
  if (fromFeed && fromFeed.length > 0) {
    console.log(`build_rss: using reports/feed.json with ${fromFeed.length} items`);
    return fromFeed.slice(0, 100);
  }
  console.log('build_rss: no usable reports/feed.json items, falling back to legacy directory scan');
  return buildFromLegacy();
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderRss(items) {
  const xmlItems = items
    .map((i) => {
      const title = escapeXml(i.title);
      const link = escapeXml(i.link);
      const pubDate = i.pubDate ? `<pubDate>${escapeXml(i.pubDate)}</pubDate>` : '';
      return `<item><title>${title}</title><link>${link}</link>${pubDate}</item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>CG Alert — Weekly Vendor Change Radar</title>
<link>${escapeXml(ORIGIN)}</link>
<description>Top recent vendor change packs</description>
${xmlItems}
</channel>
</rss>
`;
}

(function main() {
  const items = buildItems();
  fs.mkdirSync('rss', { recursive: true });
  const xml = renderRss(items);
  fs.writeFileSync(path.join('rss', 'index.xml'), xml, 'utf8');
  console.log(`build_rss: wrote rss/index.xml with ${items.length} items`);
})();
