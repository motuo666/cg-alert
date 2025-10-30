#!/usr/bin/env node
const fs = require('fs'), path=require('path');
const ROOT='cg-alert-main';
const TARGETS=['reports','who-uses','seo','dashboard','api','buy','enterprise'];
const FILES=['terms.html','privacy.html','404.html'];
function* walk(dir){
  for(const e of fs.readdirSync(dir)){
    const p=path.join(dir,e), st=fs.statSync(p);
    if(st.isDirectory()){
      if(['vendors','categories','evidence','public','.git','.github','assets','templates','artifacts'].includes(e)) continue;
      yield* walk(p);
    } else if(/\.(html?)$/i.test(e)){ yield p; }
  }
}
let fixed=0;
for(const dir of TARGETS){
  const f = path.join(ROOT,dir);
  if(!fs.existsSync(f)) continue;
  for(const file of walk(f)){
    let s=fs.readFileSync(file,'utf8'), o=s;
    s=s.replace(/href=["'](?:\.{1,2}\/)*(index\.html)?["']/gi, 'href="/"');
    s=s.replace(/href=["'](?:\.{1,2}\/)*(reports\/)?["']/gi, 'href="/reports/"');
    s=s.replace(/href=["'](?:\.{1,2}\/)*(who-uses\/)?["']/gi, 'href="/who-uses/"');
    s=s.replace(/href=["'](?:\.{1,2}\/)*(dashboard\/)?["']/gi, 'href="/dashboard/"');
    s=s.replace(/href=["'](?:\.{1,2}\/)*(legal\/terms(\.html)?)["']/gi, 'href="/legal/terms.html"');
    s=s.replace(/href=["'](?:\.{1,2}\/)*(legal\/privacy(\.html)?)["']/gi, 'href="/legal/privacy.html"');
    if(s!==o){ fs.writeFileSync(file,s,'utf8'); fixed++; console.log('fixed:', file); }
  }
}
for(const fname of FILES){
  const file = path.join(ROOT, fname);
  if(!fs.existsSync(file)) continue;
  let s=fs.readFileSync(file,'utf8'), o=s;
  s=s.replace(/href=["'](?:\.{1,2}\/)*(index\.html)?["']/gi, 'href="/"');
  s=s.replace(/href=["'](?:\.{1,2}\/)*(reports\/)?["']/gi, 'href="/reports/"');
  s=s.replace(/href=["'](?:\.{1,2}\/)*(who-uses\/)?["']/gi, 'href="/who-uses/"');
  s=s.replace(/href=["'](?:\.{1,2}\/)*(dashboard\/)?["']/gi, 'href="/dashboard/"');
  if(s!==o){ fs.writeFileSync(file,s,'utf8'); fixed++; console.log('fixed file:', file); }
}
console.log('nav fixed:', fixed);
