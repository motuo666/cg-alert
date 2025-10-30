#!/usr/bin/env node
const fs = require('fs'), path = require('path');

function detectBase(fs){
  if (fs.existsSync('cg-alert-main/index.html')) return 'cg-alert-main';
  if (fs.existsSync('index.html')) return '.';
  if (fs.existsSync('cg-alert-main')) return 'cg-alert-main';
  return '.';
}

const BASE = detectBase(fs);
const HOME = path.join(BASE, 'index.html');
if(!fs.existsSync(HOME)){ console.error('homepage not found at', HOME); process.exit(0); }
const src = fs.readFileSync(HOME,'utf8');
function grab(re){ const m = src.match(re); return m ? m[1] : ''; }
const headerTag = grab(/(<header[\s\S]*?<\/header>)/i);
const footerTag = grab(/(<footer[\s\S]*?<\/footer>)/i);
const styleTag  = grab(/(<style[^>]*>[\s\S]*?<\/style>)/i);

function* walk(dir){
  if(!fs.existsSync(dir)) return;
  for(const e of fs.readdirSync(dir)){
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if(st.isDirectory()){
      if(['vendors','categories','evidence','public','.git','.github','node_modules','assets','templates','artifacts'].includes(e)) continue;
      yield* walk(p);
    } else if(/\.(html?)$/i.test(e)){ yield p; }
  }
}
function ensureInHead(html, snippet, testRe){
  if(!snippet) return html;
  if(testRe && testRe.test(html)) return html;
  return html.replace(/<head[^>]*>/i, m => m + '\n' + snippet);
}
function swapHeaderFooter(html, file){
  let out = html;
  if(file.endsWith(path.normalize('index.html'))) return out; // keep homepage
  if(headerTag){
    if(/<header[\s>]/i.test(out)) out = out.replace(/<header[\s\S]*?<\/header>/i, headerTag);
    else if(/<body[^>]*>/.test(out)) out = out.replace(/<body[^>]*>/i, m=>m+'\n'+headerTag);
  }
  if(footerTag){
    if(/<footer[\s>]/i.test(out)) out = out.replace(/<footer[\s\S]*?<\/footer>/i, footerTag);
    else out = out.replace(/<\/body>/i, footerTag+'\n</body>');
  }
  return out;
}
const targets = ['reports','who-uses','seo','dashboard','api','buy','enterprise','legal'];
let changed=0;
for(const t of targets){
  const dir = path.join(BASE, t);
  for(const file of walk(dir)){
    let s = fs.readFileSync(file,'utf8'), o=s;
    if(!/<style[^>]*>[\s\S]*?<\/style>/i.test(s)) s = ensureInHead(s, styleTag, /<style[^>]*>[\s\S]*?<\/style>/i);
    s = ensureInHead(s, '<link rel="stylesheet" href="/enterprise.css">', /enterprise\.css/i);
    s = swapHeaderFooter(s, file);
    if(s!==o){ fs.writeFileSync(file,s,'utf8'); changed++; console.log('themed:', file); }
  }
}
console.log('unify complete, files changed:', changed);
