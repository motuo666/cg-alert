#!/usr/bin/env node
/**
 * site_doctor.js
 * - Scan both reports/** and public/reports/**
 * - Remove any page-scoped header (lets theme provide the single header)
 * - Ensure CSS (<link rel="/assets/cg-theme.css"> and /styles.css)
 * - Normalize links: evidence -> absolute, reports -> absolute, drop /public prefix
 */
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();
const TARGETS = [path.join(ROOT,'reports'), path.join(ROOT,'public','reports')];

function* walk(dir){
  let stack=[dir];
  while(stack.length){
    const d = stack.pop();
    let ents=[]; try{ ents=fs.readdirSync(d,{withFileTypes:true}); }catch{ continue; }
    for(const e of ents){
      const p = path.join(d,e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.toLowerCase()==='index.html') yield p;
    }
  }
}

function read(p){ return fs.readFileSync(p,'utf8'); }
function write(p,s){ fs.writeFileSync(p,s,'utf8'); }

function ensureCssHead(html){
  let s = html;
  if (!/href=["']\/styles\.css["']/i.test(s)){
    s = s.replace(/<\/head>/i, '\n<link rel="stylesheet" href="/styles.css">\n</head>');
  }
  if (!/href=["']\/assets\/cg-theme\.css["']/i.test(s)){
    s = s.replace(/<\/head>/i, '\n<link rel="stylesheet" href="/assets/cg-theme.css">\n</head>');
  }
  return s;
}
function normalizeLinks(s){
  s = s.replace(/href=(['"])(?:\.\.\/|\.\.\\|\.\/|\.\\)?evidence\/([^'"]+)\1/ig, (m,q,rest)=>`href="/evidence/${rest}"`);
  s = s.replace(/href=(['"])\/public\/reports\/([^'"]+)\1/ig, (m,q,rest)=>`href="/reports/${rest}"`);
  s = s.replace(/href=(['"])(?:\.\.\/|\.\.\\|\.\/|\.\\)?reports\/([^'"]+)\1/ig, (m,q,rest)=>`href="/reports/${rest}"`);
  return s;
}
function stripHeaders(s){
  return s.replace(/<header\b[^>]*>[\s\S]*?<\/header>/ig, '');
}

function processFile(fp){
  let s = read(fp); const before=s;
  s = stripHeaders(s);
  s = ensureCssHead(s);
  s = normalizeLinks(s);
  if (s !== before){ write(fp,s); return true; }
  return false;
}

(function main(){
  let scanned=0, changed=0;
  for (const base of TARGETS){
    if (!fs.existsSync(base)) continue;
    for (const f of walk(base)){ scanned++; if (processFile(f)) changed++; }
  }
  console.log(`site_doctor: scanned=${scanned} changed=${changed}`);
})();
