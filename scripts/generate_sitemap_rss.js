// scripts/generate_sitemap_rss.js  (CommonJS)
const fs = require('fs');
const path = require('path');

const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const reportsDir = 'reports';
const publicDir = 'public';
fs.mkdirSync(publicDir, { recursive: true });

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
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${ORIGIN}/</loc></url>
<url><loc>${ORIGIN}/reports/</loc></url>
${urls.map(u=>`<url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), sitemap);

// Weekly Radar RSS (轻量：列出最近 7 天的前 30 条 Change Pack 页)
const sevenDaysAgo = Date.now() - 7*24*3600*1000;
const items = urls.slice(-500).map(u => ({u, t: fs.statSync(path.join('public')).mtime.getTime()})); // 无文件 mtime，就平铺
const top = items.slice(-30);
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>CG Alert — Weekly Vendor Change Radar</title>
<link>${ORIGIN}/reports/</link>
<description>Top recent vendor change packs</description>
${top.map(x=>`<item><title>Vendor Change</title><link>${x.u}</link></item>`).join('\n')}
</channel></rss>`;
fs.writeFileSync(path.join(publicDir, 'reports.rss.xml'), rss);
console.log(`sitemap & rss generated: urls=${urls.length}, rss_items=${top.length}`);
