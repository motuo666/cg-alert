// Helper: build a stable-ish ID for each report item
function __buildStableId(item) {
  try {
    const vendor = String(item.vendor || '').toLowerCase();
    const pathPart = String(item.path || '').trim().replace(/^\/+|\/+$/g, '');
    const hash = String(item.hash || '');
    return [vendor, pathPart, hash].filter(Boolean).join('/');
  } catch (e) {
    return '';
  }
}

const fs = require('fs');
const path = require('path');

const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';

function* walkReports() {
  const rep = 'reports';
  if (!fs.existsSync(rep)) return;

  for (const ym of fs.readdirSync(rep)) {
    const ymDir = path.join(rep, ym);
    if (!/^\d{4}-\d{2}$/.test(ym) || !fs.statSync(ymDir).isDirectory()) continue;

    for (const v of fs.readdirSync(ymDir)) {
      const idx = path.join(ymDir, v, 'index.html');
      if (!fs.existsSync(idx)) continue;

      const stat = fs.statSync(idx);
      const urlPath = `/reports/${ym}/${v}/`;

      yield {
        vendor: v,
        ym,
        mtime: stat.mtime,
        url: `${ORIGIN}${urlPath}`,
        path: urlPath,
        // 简单 hash，用 mtimeMs 做一个稳定一点的字符串，主要用于 guid 唯一性
        hash: stat.mtimeMs.toString(36)
      };
    }
  }
}

function rfc822(d) {
  try {
    return new Date(d).toUTCString();
  } catch (e) {
    return new Date().toUTCString();
  }
}

function esc(s = '') {
  return String(s).replace(/[<>&'"]/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;'
  }[c] || c));
}

const all = Array.from(walkReports())
  .sort((a, b) => b.mtime - a.mtime)
  .slice(0, 100);

const itemsXml = all.map(item => {
  const guid = __buildStableId(item) || item.url;
  return `
  <item>
    <title>${esc(item.vendor)} changes — ${esc(item.ym)}</title>
    <link>${esc(item.url)}</link>
    <pubDate>${esc(rfc822(item.mtime))}</pubDate>
    <guid isPermaLink="false">${esc(guid)}</guid>
  </item>`;
}).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CG Alert — Reports</title>
    <link>${ORIGIN}/reports/</link>
    <description>Recent vendor report pages</description>
    ${itemsXml}
  </channel>
</rss>
`;

fs.mkdirSync('reports/rss', { recursive: true });
fs.writeFileSync('reports/rss/index.xml', xml, 'utf8');
console.log('wrote reports/rss/index.xml');
