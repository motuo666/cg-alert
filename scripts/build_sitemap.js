
/**
 * Build a very simple sitemap.xml merging /, /pricing, /reports, /evidence
 */
import fs from "fs/promises";
import path from "path";

async function fileExists(p){ try{ await fs.stat(p); return true;}catch{ return false; } }

async function listEvidenceDirs(){
  const base = "public/evidence";
  const res = [];
  async function walk(d){
    let ents=[];
    try { ents = await fs.readdir(d,{withFileTypes:true}); } catch { return; }
    for(const e of ents){
      const p = path.join(d,e.name);
      if(e.isDirectory()){
        await walk(p);
        if(await fileExists(path.join(p,"index.html"))){
          res.push("/"+p.replace(/^public\//,"")+"/");
        }
      }
    }
  }
  await walk(base);
  return res;
}

async function main(){
  const SITE = process.env.SITE_ORIGIN || "https://www.cg-alert.com";
  const base = ["/","/pricing/","/reports/","/evidence/","/rss/"];
  const ev = await listEvidenceDirs();
  const urls = [...new Set(base.concat(ev))];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u=>`  <url><loc>${SITE}${u}</loc></url>`).join("\n")}\n</urlset>\n`;
  await fs.writeFile("sitemap.xml", xml, "utf-8");
}
await main();
