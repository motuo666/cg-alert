// scripts/sitemaps_full.cjs
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const HOST = "https://cg-alert.com"; // 若域名不同自行改

function walk(dir) {
  const out = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile() && ent.name === "index.html") {
      out.push({
        url: "/" + p.replace(/\\/g, "/").replace(/index\.html$/, ""),
        mtime: fs.statSync(path.join(ROOT, p)).mtime
      });
    }
  }
  return out;
}

function xmlEscape(s){return s.replace(/[<>&'"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"}[c]));}

function mkSitemap(urls) {
  const items = urls.map(u=>`  <url>
    <loc>${HOST}${xmlEscape(u.url)}</loc>
    <lastmod>${u.mtime.toISOString()}</lastmod>
  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>\n`;
}

function write(rel, content){
  fs.writeFileSync(path.join(ROOT, rel), content);
  console.log("wrote", rel);
}

const core = [
  {url:"/", mtime:new Date()},
  {url:"/channel/", mtime:new Date()},
  {url:"/intake/", mtime:new Date()},
];

const vendors = walk("vendors");
const cats = walk("categories");
const reports = walk("reports");

write("sitemap-vendors.xml", mkSitemap(vendors));
write("sitemap-categories.xml", mkSitemap(cats));
write("sitemap.xml", mkSitemap([...core, ...reports]));
