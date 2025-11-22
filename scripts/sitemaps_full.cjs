const fs = require('fs');
const path = require('path');
let parse;
try {
  ({ parse } = require('xml2js'));
} catch (e) {
  console.log('[sitemaps_full] xml2js not installed; skipping optional sitemap generation.');
  process.exit(0);
}

// 设置文件路径
const rootPath = path.resolve(__dirname, '../'); // 项目根目录
const outputPath = path.join(rootPath, 'public'); // 输出文件夹

// 模拟数据：这里你需要从实际的数据源（如数据库）获取 Vendors, Categories 和 Reports 的信息
const vendors = [
  { id: 1, name: 'Vendor 1', url: '/vendor/1' },
  { id: 2, name: 'Vendor 2', url: '/vendor/2' },
  // 更多 vendors 数据
];
const categories = [
  { name: 'Category 1', url: '/category/1' },
  { name: 'Category 2', url: '/category/2' },
  // 更多 categories 数据
];
const reports = [
  { title: 'Report 1', url: '/reports/1' },
  { title: 'Report 2', url: '/reports/2' },
  // 更多 reports 数据
];

// 生成 Sitemap
const generateSitemap = () => {
  const urls = [
    { loc: '/', lastmod: new Date().toISOString() },
    ...vendors.map(vendor => ({ loc: vendor.url, lastmod: new Date().toISOString() })),
    ...categories.map(category => ({ loc: category.url, lastmod: new Date().toISOString() })),
    ...reports.map(report => ({ loc: report.url, lastmod: new Date().toISOString() })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${urls.map(url => `
      <url>
        <loc>${'https://www.cg-alert.com' + url.loc}</loc>
        <lastmod>${url.lastmod}</lastmod>
      </url>`).join('')}
  </urlset>`;

  // 将生成的 sitemap.xml 文件保存
  fs.writeFileSync(path.join(outputPath, 'sitemap.xml'), xml, 'utf8');
  console.log('Sitemap generated.');
};

// 生成 RSS
const generateRSS = () => {
  const items = [
    ...vendors.map(vendor => ({ title: vendor.name, link: `https://www.cg-alert.com${vendor.url}`, pubDate: new Date().toISOString() })),
    ...categories.map(category => ({ title: category.name, link: `https://www.cg-alert.com${category.url}`, pubDate: new Date().toISOString() })),
    ...reports.map(report => ({ title: report.title, link: `https://www.cg-alert.com${report.url}`, pubDate: new Date().toISOString() })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <title>CG Alert</title>
      <link>https://www.cg-alert.com</link>
      <description>Vendor alerts from CG Alert</description>
      ${items.map(item => `
        <item>
          <title>${item.title}</title>
          <link>${item.link}</link>
          <pubDate>${item.pubDate}</pubDate>
        </item>`).join('')}
    </channel>
  </rss>`;

  // 将生成的 rss.xml 文件保存
  fs.writeFileSync(path.join(outputPath, 'rss.xml'), xml, 'utf8');
  console.log('RSS feed generated.');
};

// 执行生成任务
generateSitemap();
generateRSS();
