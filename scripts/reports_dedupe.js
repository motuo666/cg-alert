#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd(); const REP = path.join(ROOT,'public','reports');
function exists(p){ try{ fs.accessSync(p); return true; } catch { return false; } }
if (!exists(REP)) { console.log('no public/reports'); process.exit(0); }
function* walk(dir){ const st=[dir]; while(st.length){ const d=st.pop(); for(const e of fs.readdirSync(d,{withFileTypes:true})) { const p=path.join(d,e.name); if(e.isDirectory()) st.push(p); else if(e.isFile()&&e.name.toLowerCase().endsWith('.html')) yield p; } } }
let scanned=0,fixed=0;
for(const file of walk(REP)){
  scanned++;
  let s=fs.readFileSync(file,'utf8');
  const headers=(s.match(/<header\b/ig)||[]).length;
  const footers=(s.match(/<footer\b/ig)||[]).length;
  const htmlTags=(s.match(/<html\b/ig)||[]).length;
  if (headers>1 || footers>1 || htmlTags>1){
    // Remove nested <html/head/body>, keep first header/footer occurrence
    s = s.replace(/<!doctype[^>]*>/ig,'');
    s = s.replace(/<\/?(html|head|body)\b[^>]*>/ig,'');
    // Keep only first header/footer blocks
    const headerBlocks = s.match(/<header\b[^>]*>[\s\S]*?<\/header>/ig) || [];
    if (headerBlocks.length>1){
      s = s.replace(/<header\b[^>]*>[\s\S]*?<\/header>/ig, (m)=> (m===headerBlocks[0]? m : ''));
    }
    const footerBlocks = s.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/ig) || [];
    if (footerBlocks.length>1){
      let first = true;
      s = s.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/ig, (m)=> {
        if (first){ first=false; return m; }
        return '';
      });
    }
    fs.writeFileSync(file,s,'utf8'); fixed++;
  }
}
console.log(`reports-dedupe: scanned=${scanned} fixed=${fixed}`);
