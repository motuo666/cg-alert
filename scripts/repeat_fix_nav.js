#!/usr/bin/env node
const fs = require('fs'), path = require('path');

function detectBase(fs){
  if (fs.existsSync('cg-alert-main/index.html')) return 'cg-alert-main';
  if (fs.existsSync('index.html')) return '.';
  if (fs.existsSync('cg-alert-main')) return 'cg-alert-main';
  return '.';
}

const BASE = detectBase(fs);
function* walk(dir){
  if(!fs.existsSync(dir)) return;
  for(const e of fs.readdirSync(dir)){
    const p=path.join(dir,e), st=fs.statSync(p);
    if(st.isDirectory()){ if(['vendors','categories','evidence','public','.git','.github','assets','templates','artifacts','node_modules'].includes(e)) continue; yield* walk(p); }
    else if(/\.(html?)$/i.test(e)) yield p;
  }
}
const dirs = ['reports','who-uses','seo','dashboard','api','buy','enterprise','legal'];
let fixed=0;
for(const d of dirs){
  const dir = path.join(BASE,d);
  for(const file of walk(dir)){
    let s=fs.readFileSync(file,'utf8'), o=s;
    s = s.replace(/href=["'](?:\.(1, 2)\/)*(index\.html)?["']/gi, 'href="/"');
    s = s.replace(/href=["'](?:\.(1, 2)\/)*(reports\/)?["']/gi, 'href="/reports/"');
    s = s.replace(/href=["'](?:\.(1, 2)\/)*(who-uses\/)?["']/gi, 'href="/who-uses/"');
    s = s.replace(/href=["'](?:\.(1, 2)\/)*(dashboard\/)?["']/gi, 'href="/dashboard/"');
    s = s.replace(/href=["'](?:\.(1, 2)\/)*(legal\/terms(\.html)?)["']/gi, 'href="/legal/terms.html"');
    s = s.replace(/href=["'](?:\.(1, 2)\/)*(legal\/privacy(\.html)?)["']/gi, 'href="/legal/privacy.html"');
    if(s!==o){ fs.writeFileSync(file,s,'utf8'); fixed++; console.log('fixed:', file); }
  }
}
console.log('nav fixed:', fixed);
