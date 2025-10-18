/* scripts/sitemaps_full.cjs */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ORIGIN = process.env.SITE_ORIGIN || "https://www.cg-alert.com";
const PUBLIC_DIR = "public";
const REPORTS_DIR = "reports";
const VENDORS_DIR = "vendors";
const CATEGORIES_DIR = "categories";

fs.mkdirSync(PUBLIC_DIR, { recursive: true });

/** ---------- utils ---------- */
const xmlEscape = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

function encodePathSegments(p) {
  // ensure leading slash, encode each segment (except empty & slashes)
  const parts = p.split("/").map((seg) => (seg ? encodeURIComponent(seg) : seg));
  let out = parts.join("/").replace(/\/+/g, "/");
  if (!out.startsWith("/")) out = "/" + out;
  return out;
}

function lastmodOf(filePath) {
  try {
    return fs.statSync(filePath).mtime;
  } catch {
    return new Date();
  }
}

/** 递归遍历目录中带 index.html 的路由 */
function collectFrom(dir) {
  const res = [];
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) return res;

  /** DFS */
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(abs);
      } else if (ent.isFile() && ent.name === "index.html") {
        // turn ".../reports/2025-10/pack-a/index.html" -> "/reports/2025-10/pack-a/"
        const rel = path.relative(process.cwd(), abs).replace(/\\/g, "/");
        const urlPath = "/" + rel.replace(/\/index\.html$/i, "");
        res.push({
          url: encodePathSegments(urlPath + "/"),
          mtime: lastmodOf(abs)
        });
      }
    }
  }
  return res;
}

/** 生成 sitemap xml */
function buildSitemap(urls) {
  const items = urls
    .sort((a, b) => b.mtime - a.mtime)
    .map(
      ({ url, mtime }) => `  <url>
    <loc>${ORIGIN}${xmlEscape(url)}</loc>
    <lastmod>${new Date(mtime).toISOString()}</lastmod>
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>
`;
}

/** 写文件并日志 */
function writeOut(rel, content) {
  const dest = path.join(PUBLIC_DIR, rel);
  fs.writeFileSync(dest, content);
  console.log("wrote", rel, `(${content.length} bytes)`);
}

/** ---------- collect URLs ---------- */
const coreUrls = [];
// 尝试把首页、reports、vendors、categories 首页也纳入（若有 index.html）
[
  { p: "index.html", url: "/" },
  { p: path.join(REPORTS_DIR, "index.html"), url: "/reports/" },
  { p: path.join(VENDORS_DIR, "index.html"), url: "/vendors/" },
  { p: path.join(CATEGORIES_DIR, "index.html"), url: "/categories/" }
].forEach(({ p, url }) => {
  if (fs.existsSync(p)) {
    coreUrls.push({ url: encodePathSegments(url), mtime: lastmodOf(p) });
  }
});

const reportUrls = collectFrom(REPORTS_DIR);
const vendorUrls = collectFrom(VENDORS_DIR);
const categoryUrls = collectFrom(CATEGORIES_DIR);

/** ---------- emit sitemaps ---------- */
// 主 sitemap：核心页 + reports
writeOut("sitemap.xml", buildSitemap([...coreUrls, ...reportUrls]));
// 供应商 & 分类细分 sitemap
writeOut("sitemap-vendors.xml", buildSitemap(vendorUrls));
writeOut("sitemap-categories.xml", buildSitemap(categoryUrls));

// 可选：站点地图索引（提交一个入口即可）
const nowIso = new Date().toISOString();
const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${ORIGIN}/sitemap.xml</loc><lastmod>${nowIso}</lastmod></sitemap>
  <sitemap><loc>${ORIGIN}/sitemap-vendors.xml</loc><lastmod>${nowIso}</lastmod></sitemap>
  <sitemap><loc>${ORIGIN}/sitemap-categories.xml</loc><lastmod>${nowIso}</lastmod></sitemap>
</sitemapindex>
`;
writeOut("sitemap-index.xml", sitemapIndex);

/** ---------- RSS (最近 30 条周榜/报告) ---------- */
const latestReports = [...reportUrls].sort((a, b) => b.mtime - a.mtime).slice(0, 30);
const rssItems = latestReports
  .map(({ url, mtime }) => {
    const slug = decodeURIComponent(url.split("/").filter(Boolean).slice(-1)[0] || "Vendor Change");
    return `  <item>
    <title>${xmlEscape(`Vendor Change — ${slug}`)}</title>
    <link>${ORIGIN}${xmlEscape(url)}</link>
    <guid isPermaLink="true">${ORIGIN}${xmlEscape(url)}</guid>
    <pubDate>${new Date(mtime).toUTCString()}</pubDate>
    <description>${xmlEscape("Top recent vendor change pack")}</description>
  </item>`;
  })
  .join("\n");

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>CG Alert — Weekly Vendor Change Radar</title>
  <link>${ORIGIN}/reports/</link>
  <description>Top recent vendor change packs</description>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${rssItems}
</channel>
</rss>
`;
writeOut("reports.rss.xml", rss);

/** ---------- summary ---------- */
const total =
  coreUrls.length + reportUrls.length + vendorUrls.length + categoryUrls.length;
console.log(
  `sitemaps & rss generated:
  core=${coreUrls.length}, reports=${reportUrls.length}, vendors=${vendorUrls.length}, categories=${categoryUrls.length}
  total_urls=${total}, rss_items=${latestReports.length}`
);
