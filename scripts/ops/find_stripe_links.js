// scripts/ops/find_stripe_links.js
// Usage: node scripts/ops/find_stripe_links.js
// Prints all Stripe buy links in public/**/*.html and whether they include utm_* and lid=
import fs from "fs";
import path from "path";

const ROOT = "public";
const reA = /<a\b[^>]+href=["']([^"']+)["'][^>]*>/ig;

function walk(dir){
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile() && f.toLowerCase().endsWith(".html")) out.push(p);
  }
  return out;
}

function main(){
  const files = walk(ROOT);
  let count = 0;
  for (const file of files) {
    const html = fs.readFileSync(file, "utf-8");
    let m;
    while ((m = reA.exec(html)) !== null) {
      const href = m[1];
      if (!/^https?:\/\/(buy\.)?stripe\.com\//i.test(href)) continue;
      const q = href.split("?")[1] || "";
      const okUtm = /utm_source=/.test(q) && /utm_medium=/.test(q) && /utm_campaign=/.test(q);
      const okLid = /(^|&)lid=/.test(q);
      console.log(JSON.stringify({file, href, okUtm, okLid}));
      count++;
    }
  }
  console.log("total stripe links:", count);
}

main();
