#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const HOME = path.join('cg-alert-main','index.html');
const HOME_FALLBACK = 'index.html';
const home = fs.existsSync(HOME) ? HOME : (fs.existsSync(HOME_FALLBACK) ? HOME_FALLBACK : null);
if(!home){ console.error('homepage not found'); process.exit(1); }
const src = fs.readFileSync(home,'utf8');
function grab(re){ const m=src.match(re); return m?m[1]:''; }
const headerTag = grab(/(<header[\s\S]*?<\/header>)/i);
const footerTag = grab(/(<footer[\s\S]*?<\/footer>)/i);
const styleTag  = grab(/(<style[^>]*>[\s\S]*?<\/style>)/i);
const faviconLinks = (src.match(/<link[^>]+rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/gi) || []).join('\n');

function* walk(dir){
  for(const e of fs.readdirSync(dir)){
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if(st.isDirectory()){
      if(['node_modules','.git','evidence','public','artifacts','vendors','categories'].includes(e)) continue;
      yield* walk(p);
    } else if(/\.(html?)$/i.test(e)){
      yield p;
    }
  }
}
function ensureInHead(html, snippet, testRe){
  if(!snippet) return html;
  if(testRe && testRe.test(html)) return html;
  return html.replace(/<head[^>]*>/i, m => m + '\n' + snippet);
}
function swapHeaderFooter(html, file){
  // Skip homepage body structure (we keep it intact)
  if(file.replace(/\\/g,'/').endsWith(home.replace(/\\/g,'/'))) return html;
  let out = html;
  if(headerTag){
    if(/<header[\s>]/i.test(out)){
      out = out.replace(/<header[\s\S]*?<\/header>/i, headerTag);
    }else if(/<body[^>]*>/.test(out)){
      out = out.replace(/<body[^>]*>/i, m=>m + '\n' + headerTag);
    }
  }
  if(footerTag){
    if(/<footer[\s>]/i.test(out)){
      out = out.replace(/<footer[\s\S]*?<\/footer>/i, footerTag);
    }else{
      out = out.replace(/<\/body>/i, footerTag + '\n</body>');
    }
  }
  return out;
}
const roots = ['cg-alert-main','reports','who-uses','terms','privacy','seo','dashboard','legal','pages','docs'];
let changed=0;
for(const r of roots){
  if(!fs.existsSync(r)) continue;
  for(const file of walk(r)){
    let s = fs.readFileSync(file,'utf8'), out=s;
    out = ensureInHead(out, styleTag, /<style[^>]*>[\s\S]*?<\/style>/i); // inject homepage style only if page lacks any style
    out = ensureInHead(out, '<link rel="stylesheet" href="/enterprise.css">', /enterprise\.css/i);
    if(faviconLinks) out = ensureInHead(out, faviconLinks, /(rel=["'](?:icon|shortcut icon|apple-touch-icon)["'])/i);
    out = swapHeaderFooter(out, file);
    if(out!==s){ fs.writeFileSync(file,out,'utf8'); changed++; console.log('themed:', file); }
  }
}
console.log('unify complete; files changed:', changed);
