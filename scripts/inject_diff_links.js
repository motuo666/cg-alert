#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EVID = path.join(ROOT, 'public', 'evidence');

function exists(p){ try { fs.accessSync(p); return true; } catch { return false; } }

function* walk(dir){
  const stack=[dir];
  while(stack.length){
    const d = stack.pop();
    let ents=[];
    try{ ents = fs.readdirSync(d,{withFileTypes:true}); } catch{ continue; }
    let hasDiff = exists(path.join(d,'diff.html'));
    let idx = path.join(d,'index.html');
    if (hasDiff && exists(idx)) yield [idx, path.join(d,'diff.html')];
    for(const e of ents){
      const p = path.join(d,e.name);
      if (e.isDirectory()) stack.push(p);
    }
  }
}

let injected=0, skipped=0;
for (const [idx, diff] of walk(EVID)){
  let html = fs.readFileSync(idx,'utf8');
  if (html.includes('href="diff.html"') || html.includes('>Diff<')) { skipped++; continue; }
  const link = `<p><a href="diff.html" rel="nofollow">View change diff</a></p>`;
  if (html.includes('</body>')){
    html = html.replace('</body>', `${link}\n</body>`);
  } else {
    html += link;
  }
  fs.writeFileSync(idx, html, 'utf8');
  injected++;
}
console.log(`Inject diff link: injected=${injected} skipped=${skipped}`);
