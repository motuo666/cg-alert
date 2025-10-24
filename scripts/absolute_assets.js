#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();
const PUB = path.join(ROOT, 'public');
const ABS_RE = /^(https?:)?\/\//;
function* walk(dir){
  const stack=[dir];
  while(stack.length){
    const d = stack.pop();
    let ents=[]; try{ ents = fs.readdirSync(d,{withFileTypes:true}); } catch{ continue; }
    for(const e of ents){
      const p = path.join(d,e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) yield p;
    }
  }
}
function rewrite(html){
  // make href/src absolute if they are relative (e.g., assets/app.css -> /assets/app.css)
  html = html.replace(/(<link[^>]+href=['"])([^'"]+)(['"][^>]*>)/ig, (m, pre, url, post) => {
    if (ABS_RE.test(url) || url.startsWith('/')) return m;
    if (url.startsWith('#')) return m;
    return pre + '/' + url.replace(/^\.?\//,'') + post;
  });
  html = html.replace(/(<script[^>]+src=['"])([^'"]+)(['"][^>]*>)/ig, (m, pre, url, post) => {
    if (ABS_RE.test(url) || url.startsWith('/')) return m;
    if (url.startsWith('#')) return m;
    return pre + '/' + url.replace(/^\.?\//,'') + post;
  });
  // also fix <a href> for top-nav if it points to relative path like index.html
  html = html.replace(/(<a[^>]+href=['"])(index\.html)(['"][^>]*>)/ig, `$1/$3`);
  return html;
}
function main(){
  if (!fs.existsSync(PUB)) { console.log('No public/ directory'); process.exit(0); }
  let scanned=0, changed=0;
  for (const file of walk(PUB)){
    scanned++;
    const inp = fs.readFileSync(file,'utf8');
    const out = rewrite(inp);
    if (out !== inp){
      fs.writeFileSync(file, out,'utf8');
      changed++;
    }
  }
  console.log(`absolute-assets: scanned=${scanned} changed=${changed}`);
}
main();
