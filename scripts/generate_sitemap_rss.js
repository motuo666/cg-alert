const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const reportsDir = 'reports';

function* iterReportUrls() {
  if (!fs.existsSync(reportsDir)) return;
  for (const ym of fs.readdirSync(reportsDir)) {
    const p = path.join(reportsDir, ym);
    if (!/^\d{4}-\d{2}$/.test(ym) || !fs.statSync(p).isDirectory()) continue;
    for (const v of fs.readdirSync(p)) {
      const idx = path.join(p, v, 'index.html');
      if (fs.existsSync(idx)) yield `${ORIGIN}/reports/${ym}/${encodeURIComponent(v)}/`;
    }
  }
}

const urls = Array.from(iterReportUrls());

// root sitemap.xml
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${ORIGIN}/</loc></url>
<url><loc>${ORIGIN}/reports/</loc></url>
${urls.map(u=>`<url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;

fs.writeFileSync('sitemap.xml', sitemap, 'utf8');

// /reports/rss.xml (recent 30)
const items = urls.slice(-30);
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>CG Alert — Weekly Vendor Change Radar</title>
<link>${ORIGIN}/reports/</link>
<description>Top recent vendor change packs</description>
${items.map(u=>`<item><title>Vendor Change</title><link>${u}</link></item>`).join('\n')}
</channel></rss>`;

require('fs').mkdirSync('reports', { recursive: true });
fs.writeFileSync(path.join('reports', 'rss.xml'), rss, 'utf8');

console.log(`sitemap & reports/rss.xml generated: urls=${urls.length}, rss_items=${items.length}`);
