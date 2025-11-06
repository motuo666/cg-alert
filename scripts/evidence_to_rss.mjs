
/**
 * Build a minimal RSS feed from confirmed evidence items.
 */
import fs from "fs/promises";
import path from "path";

function esc(s){return s.replace(/[<>&]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]));}

async function readJson(p){return JSON.parse(await fs.readFile(p,"utf-8"));}
async function ensureDir(d){await fs.mkdir(d,{recursive:true});}

async function listEvidenceJson() {
  const out = [];
  async function walk(base){
    const ents = await fs.readdir(base,{withFileTypes:true});
    for(const e of ents){
      const p = path.join(base, e.name);
      if(e.isDirectory()){ await walk(p); continue; }
      if(p.endsWith(".json") && !p.includes("/.pending/") && !p.includes("/.confirmed/") && !p.endsWith("_last_poll.json")){
        out.push(p);
      }
    }
  }
  try { await walk("evidence"); } catch {}
  return out.sort().slice(-200); // last 200
}

function rssItem(site, item){
  const title = `${item.vendor} · ${item.page}`;
  const link = `${site}/evidence/${item.vendor}/${item.key}/`;
  const pubDate = new Date(item.confirmed_at || item.first_seen_at || Date.now()).toUTCString();
  const desc = esc(item.snippet || "");
  return `<item><title>${esc(title)}</title><link>${esc(link)}</link><pubDate>${pubDate}</pubDate><description>${desc}</description></item>`;
}

async function main(){
  const SITE = process.env.SITE_ORIGIN || "https://www.cg-alert.com";
  const files = await listEvidenceJson();
  const items = [];
  for(const f of files){
    const it = await readJson(f);
    if(!it.confirmed_at) continue; // only confirmed
    items.push(rssItem(SITE, it));
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>CG Alert – Evidence</title>
<link>${SITE}</link>
<description>Confirmed vendor changes</description>
${items.join("\n")}
</channel></rss>`;
  const outDir = path.join("public","rss");
  await ensureDir(outDir);
  await fs.writeFile(path.join(outDir,"index.xml"), xml, "utf-8");
}
await main();
