#!/usr/bin/env node
/**
 * unify_theme_from_home.js
 * Extract <style>, <header>, <footer> from cg-alert-main/index.html,
 * inject into all subpages to match homepage style.
 * Skips the homepage file itself.
 */
const fs = require('fs'); const path = require('path');
const HOME = path.join('cg-alert-main','index.html');
if(!fs.existsSync(HOME)){ console.error('homepage not found:', HOME); process.exit(1); }
const src = fs.readFileSync(HOME,'utf8');

function grab(re){ const m = src.match(re); return m ? m[1] : ''; }
const styleTag = grab(/(<style[^>]*>[\s\S]*?<\/style>)/i) || '';
const headerTag = grab(/(<header[\s\S]*?<\/header>)/i) || '';
const footerTag = grab(/(<footer[\s\S]*?<\/footer>)/i) || '';

function* walk(dir){
  for (const e of fs.readdirSync(dir)){
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()){
      if (['node_modules','.git','evidence','public','artifacts','vendors','categories'].includes(e)) continue;
      yield* walk(p);
    } else if (/\.(html?)$/i.test(e)){
      yield p;
    }
  }
}

function ensureStyle(html){
  if(!styleTag) return html;
  // If page already has a style block, keep it (do not duplicate). Else inject ours.
  if(/<style[^>]*>[\s\S]*?<\/style>/i.test(html)) return html;
  return html.replace(/<head[^>]*>/i, m => m + '\n' + styleTag);
}

function injectHeaderFooter(html, file){
  if(/cg-alert-main[\\\/]index\.html$/.test(file)) return html; // don't touch homepage
  if(!/<body[^>]*>/.test(html)) return html;
  let out = html;
  if(headerTag && !/<header[\s>]/i.test(out)) out = out.replace(/<body[^>]*>/i, m => m + '\n' + headerTag);
  if(footerTag && !/<footer[\s>]/i.test(out)) out = out.replace(/<\/body>/i, footerTag + '\n</body>');
  return out;
}

const ROOTS = ['cg-alert-main','reports','who-uses','terms','privacy','seo','dashboard','legal'];
let themed = 0;
for (const r of ROOTS){
  if(!fs.existsSync(r)) continue;
  for(const file of walk(r)){
    let s = fs.readFileSync(file,'utf8');
    const before = s;
    s = ensureStyle(s);
    s = injectHeaderFooter(s, file);
    if(s !== before){
      fs.writeFileSync(file, s, 'utf8');
      themed++; console.log('themed:', file);
    }
  }
}
console.log('unify theme done. files changed:', themed);
