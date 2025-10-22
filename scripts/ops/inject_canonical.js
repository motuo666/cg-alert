// node scripts/ops/inject_canonical.js
import fs from "fs"; import path from "path";
const ROOT = "public";
function walk(d){return fs.readdirSync(d).flatMap(f=>{
  const p = path.join(d,f), s = fs.statSync(p);
  return s.isDirectory()?walk(p):p.toLowerCase().endsWith(".html")?[p]:[];
});}
const files = walk(ROOT); let n=0;
for(const file of files){
  let html = fs.readFileSync(file,"utf-8");
  if (/rel=["']canonical["']/.test(html)) continue;
  const rel = file.replace(/^public\//,"/");     // "/path/to/page.html"
  const canon = `https://www.cg-alert.com${rel.replace(/index\.html$/,"")}`;
  html = html.replace(/<\/head>/i, `  <link rel="canonical" href="${canon}">\n</head>`);
  fs.writeFileSync(file, html); n++;
}
console.log("canonical injected:", n);
