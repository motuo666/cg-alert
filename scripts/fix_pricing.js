#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();
const RE_MAP = [
  [/(\$\s?30\s?[0,]*|\$\s?30,?000|30k)/gi, '$18,000+'],
  [/(Portfolio\s*[:\-]?\s*)\$?\s?\d[\d,]*/gi, '$1$2,988/yr'],
  [/(Business\s*[:\-]?\s*)\$?\s?\d[\d,]*/gi, '$1$6,000/yr']
];
function* walk(dir){
  for(const e of fs.readdirSync(dir)){
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if(st.isDirectory()){
      if (['node_modules','.git','evidence','public','artifacts'].includes(e)) continue;
      yield* walk(p);
    }else if(/\.html?$/i.test(e)){
      yield p;
    }
  }
}
let touched = 0;
for(const file of walk(ROOT)){
  let s = fs.readFileSync(file, 'utf8');
  let out = s;
  for(const [re,rep] of RE_MAP){
    out = out.replace(re, (m, g1)=> rep.replace('$1', g1||''));
  }
  if(out !== s){
    fs.writeFileSync(file, out, 'utf8');
    console.log('pricing fixed:', path.relative(ROOT,file));
    touched++;
  }
}
console.log('pricing fix complete, files:', touched);
