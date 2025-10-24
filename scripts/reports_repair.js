#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();
const REPORTS = path.join(ROOT, 'public','reports');
function exists(p){ try{ fs.accessSync(p); return true; } catch { return false; } }
if (!exists(REPORTS)) { console.log('No public/reports/ directory'); process.exit(0); }
let fixed=0, scanned=0;
function read(p){ return fs.readFileSync(p,'utf8'); }
function write(p, s){ fs.writeFileSync(p,s,'utf8'); }
function stripDupHeaderFooter(html){
  // remove extra nested <html>/<head>/<body> and duplicate <header>/<footer> blocks
  let s = html.replace(/<!doctype[^>]*>/ig,''); // remove extra doctypes
  // unwrap nested document tags
  s = s.replace(/<\/?(html|head|body)\b[^>]*>/ig,'');
  // if there are multiple headers, keep the first
  const parts = s.split(/<header\b[^>]*>/i);
  if (parts.length>2){
    // keep first header block and drop subsequent
    const firstHeader = '<header' + s.match(/<header\b[^>]*>[\s\S]*?<\/header>/i)[0].split('<header')[1];
    s = firstHeader + s.split(/<\/header>/i).slice(1).join('</header>');
  }
  // same for footer
  const fparts = s.split(/<footer\b[^>]*>/i);
  if (fparts.length>2){
    const firstFooter = '<footer' + s.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/i)[0].split('<footer')[1];
    s = s.split(/<\/footer>/i)[0] + '</footer>' + s.split(/<\/footer>/i).slice(-1)[0];
  }
  return s;
}
function* walk(dir){
  const stack=[dir];
  while(stack.length){
    const d = stack.pop();
    let ents=[]; try{ ents = fs.readdirSync(d,{withFileTypes:true}); } catch { continue; }
    for(const e of ents){
      const p = path.join(d,e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) yield p;
    }
  }
}
for (const file of walk(REPORTS)){
  scanned++;
  let html = read(file);
  if ((html.match(/<header\b/ig)||[]).length > 1 || (html.match(/<html\b/ig)||[]).length>1){
    const fixedHtml = stripDupHeaderFooter(html);
    if (fixedHtml !== html){
      write(file, fixedHtml);
      fixed++;
    }
  }
}
console.log(`reports-repair: scanned=${scanned} fixed=${fixed}`);
