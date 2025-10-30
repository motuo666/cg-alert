#!/usr/bin/env node
const fs = require('fs'), path=require('path');
const HOME='cg-alert-main/index.html';
if(!fs.existsSync(HOME)){ console.error('no homepage'); process.exit(0); }
const src = fs.readFileSync(HOME,'utf8');
function grab(re){ const m=src.match(re); return m?m[1]:''; }
const headerTag = grab(/(<header[\s\S]*?<\/header>)/i);
const footerTag = grab(/(<footer[\s\S]*?<\/footer>)/i);
const styleTag  = grab(/(<style[^>]*>[\s\S]*?<\/style>)/i);

const TARGETS = [
  'cg-alert-main/reports',
  'cg-alert-main/who-uses',
  'cg-alert-main/seo',
  'cg-alert-main/dashboard',
  'cg-alert-main/api',
  'cg-alert-main/buy',
  'cg-alert-main/enterprise',
];
const STANDALONE_FILES = [
  'cg-alert-main/terms.html',
  'cg-alert-main/privacy.html',
  'cg-alert-main/404.html'
];
function* walk(dir){
  if(!fs.existsSync(dir)) return;
  for(const e of fs.readdirSync(dir)){
    const p=path.join(dir,e), st=fs.statSync(p);
    if(st.isDirectory()){
      if(['vendors','categories','evidence','public','.git','.github','assets','templates','artifacts'].includes(e)) continue;
      yield* walk(p);
    } else if(/\.(html?)$/i.test(e)){
      yield p;
    }
  }
}
function ensureInHead(html, snippet, testRe){
  if(!snippet) return html;
  if(testRe && testRe.test(html)) return html;
  return html.replace(/<head[^>]*>/i, m=> m + '\n' + snippet);
}
function swapHeaderFooter(html){
  let out = html;
  if(headerTag){
    if(/<header[\s>]/i.test(out)) out = out.replace(/<header[\s\S]*?<\/header>/i, headerTag);
    else if(/<body[^>]*>/.test(out)) out = out.replace(/<body[^>]*>/i, m=> m + '\n' + headerTag);
  }
  if(footerTag){
    if(/<footer[\s>]/i.test(out)) out = out.replace(/<footer[\s\S]*?<\/footer>/i, footerTag);
    else out = out.replace(/<\/body>/i, footerTag + '\n</body>');
  }
  return out;
}
let changed=0;
for(const dir of TARGETS){
  for(const file of walk(dir)){
    let s = fs.readFileSync(file,'utf8'), o=s;
    if(!/<style[^>]*>[\s\S]*?<\/style>/i.test(s)) s=ensureInHead(s, styleTag, /<style[^>]*>[\s\S]*?<\/style>/i);
    s=ensureInHead(s, '<link rel="stylesheet" href="/enterprise.css">', /enterprise\.css/i);
    s=swapHeaderFooter(s);
    if(s!==o){ fs.writeFileSync(file,s,'utf8'); changed++; console.log('themed:', file); }
  }
}
for(const file of STANDALONE_FILES){
  if(!fs.existsSync(file)) continue;
  let s = fs.readFileSync(file,'utf8'), o=s;
  if(!/<style[^>]*>[\s\S]*?<\/style>/i.test(s)) s=ensureInHead(s, styleTag, /<style[^>]*>[\s\S]*?<\/style>/i);
  s=ensureInHead(s, '<link rel="stylesheet" href="/enterprise.css">', /enterprise\.css/i);
  s=swapHeaderFooter(s);
  if(s!==o){ fs.writeFileSync(file,s,'utf8'); changed++; console.log('themed:', file); }
}
console.log('unify complete:', changed);
