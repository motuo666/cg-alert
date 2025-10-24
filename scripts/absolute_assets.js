#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd(); const PUB = path.join(ROOT, 'public');
function* walk(dir){ const st=[dir]; while(st.length){ const d=st.pop(); let es=[]; try{ es=fs.readdirSync(d,{withFileTypes:true}); }catch{ continue; } for(const e of es){ const p=path.join(d,e.name); if(e.isDirectory()) st.push(p); else if(e.isFile() && e.name.toLowerCase().endsWith('.html')) yield p; } } }
function absRewrite(html){
  const ABS=/^(https?:)?\/\//i;
  const fixAttr=(m,pre,url,post)=>{
    if (ABS.test(url) || url.startsWith('/') || url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('data:')) return m;
    return pre + '/' + url.replace(/^\.?\//,'') + post;
  };
  html = html.replace(/(<link[^>]+href=['"])([^'"]+)(['"][^>]*>)/ig, fixAttr);
  html = html.replace(/(<script[^>]+src=['"])([^'"]+)(['"][^>]*>)/ig, fixAttr);
  html = html.replace(/(<a[^>]+href=['"])(index\.html)(['"][^>]*>)/ig, '$1/$3');
  return html;
}
let scanned=0,changed=0;
for(const file of walk(PUB)){
  scanned++;
  const s=fs.readFileSync(file,'utf8'); const t=absRewrite(s);
  if (t!==s){ fs.writeFileSync(file,t,'utf8'); changed++; }
}
console.log(`absolute-assets: scanned=${scanned} changed=${changed}`);
