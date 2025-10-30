#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
function* walk(dir){
  for(const e of fs.readdirSync(dir)){
    const p = path.join(dir, e), st=fs.statSync(p);
    if(st.isDirectory()){
      if(['node_modules','.git','evidence','public','artifacts'].includes(e)) continue;
      yield* walk(p);
    } else if(/\.(html?)$/i.test(e)){ yield p; }
  }
}
const roots=['cg-alert-main','reports','who-uses','terms','privacy','seo','dashboard','legal','pages','docs'];
let fixed=0;
for(const r of roots){
  if(!fs.existsSync(r)) continue;
  for(const file of walk(r)){
    let s=fs.readFileSync(file,'utf8'), out=s;
    out = out.replace(/href=["'](?:\.{1,2}\/)*(index\.html)?["']/gi, 'href="/"');
    out = out.replace(/href=["'](?:\.{1,2}\/)*(reports\/)?["']/gi, 'href="/reports/"');
    out = out.replace(/href=["'](?:\.{1,2}\/)*(who-uses\/)?["']/gi, 'href="/who-uses/"');
    out = out.replace(/href=["'](?:\.{1,2}\/)*(dashboard\/)?["']/gi, 'href="/dashboard/"');
    out = out.replace(/href=["'](?:\.{1,2}\/)*(legal\/terms(\.html)?)["']/gi, 'href="/legal/terms.html"');
    out = out.replace(/href=["'](?:\.{1,2}\/)*(legal\/privacy(\.html)?)["']/gi, 'href="/legal/privacy.html"');
    if(out!==s){ fs.writeFileSync(file,out,'utf8'); fixed++; console.log('fixed:', file); }
  }
}
console.log('nav links fixed:', fixed);
