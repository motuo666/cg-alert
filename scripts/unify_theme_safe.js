
#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();
const header = fs.existsSync(path.join('fragments','header.html'))
  ? fs.readFileSync(path.join('fragments','header.html'),'utf8') : '';
const footer = fs.existsSync(path.join('fragments','footer.html'))
  ? fs.readFileSync(path.join('fragments','footer.html'),'utf8') : '';

const targets = ['reports', 'who-uses', 'terms', 'privacy', 'seo']; // note: skip '.' so root index.html won't be touched

function* walk(dir){
  for(const e of fs.readdirSync(dir)){
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if(st.isDirectory()){
      if (['node_modules','.git','evidence','public','artifacts','vendors','categories'].includes(e)) continue;
      yield* walk(p);
    }else if(/\.html?$/i.test(e)){
      yield p;
    }
  }
}
function ensureStyles(text){
  if(/href=["']\/?styles\.css["']/.test(text)) return text;
  return text.replace(/<head>/i, '<head>\n<link rel="stylesheet" href="/styles.css">');
}
function injectHF(text){
  if(!/<body[^>]*>/.test(text)) return text;
  let out = text;
  if(header) out = out.replace(/<body[^>]*>/i, m=>m + '\n' + header);
  if(footer && !/footer class="site"/.test(out)) out = out.replace(/<\/body>/i, footer + '\n</body>');
  return out;
}

for(const folder of targets){
  const base = path.join(ROOT, folder);
  if(!fs.existsSync(base)) continue;
  for(const file of walk(base)){
    let s = fs.readFileSync(file, 'utf8');
    const before = s;
    s = ensureStyles(s);
    s = injectHF(s);
    if(s !== before){
      fs.writeFileSync(file, s, 'utf8');
      console.log('themed:', path.relative(ROOT,file));
    }
  }
}
console.log('safe theme unify complete (root index.html untouched)');
