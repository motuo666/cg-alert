#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const ROOT = process.cwd();
const TARGET = '/enterprise/';
const exts = new Set(['.html','.htm','.md','.mdx','.xml','.txt','.json','.yaml','.yml','.js']);

function* walk(d){
  for(const e of fs.readdirSync(d, {withFileTypes:true})){
    const p = path.join(d, e.name);
    if(e.isDirectory()) yield* walk(p);
    else yield p;
  }
}
let changed = 0;
for(const f of walk(path.join(ROOT,'public'))){
  const ext = path.extname(f).toLowerCase();
  if(!exts.has(ext)) continue;
  const s = fs.readFileSync(f, 'utf8');
  const ns = s.replace(/href=["']mailto:[^"']*["']/gi, `href="${TARGET}"`);
  if(ns !== s){
    fs.writeFileSync(f, ns);
    changed++;
    console.log('replaced:', f);
  }
}
console.log('mailto replacements:', changed);
