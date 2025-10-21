// scripts/ops/sitemap_sync.js
import fs from "fs";
const src = "public/sitemap.xml";
const dst = "sitemap.xml";
try {
  if (fs.existsSync(src)) {
    const a = fs.readFileSync(src, "utf-8");
    fs.writeFileSync(dst, a);
    console.log("sitemap_sync: copied public/sitemap.xml -> sitemap.xml");
  } else {
    console.log("sitemap_sync: source public/sitemap.xml not found; skip");
  }
} catch(e) {
  console.error("sitemap_sync error:", e);
  process.exit(1);
}
