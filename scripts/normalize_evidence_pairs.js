#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EVID = path.join(ROOT, 'public', 'evidence');
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT,'config','diff_rules.json'),'utf8'));

function exists(p){ try { fs.accessSync(p); return true; } catch { return false; } }
function readFile(p){ return fs.readFileSync(p,'utf8'); }
function stripTags(s){ return s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' '); }
function normalizeText(s){
  if (RULES.normalize.strip_common_banners){
    s = s.replace(/cookie(s)?\s*policy/ig,'cookie-policy').replace(/accept all cookies/ig,'accept-all-cookies');
  }
  if (RULES.normalize.collapse_whitespace){
    s = s.replace(/\r\n/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n');
  }
  return s.trim();
}
function* walk(dir){
  const stack=[dir];
  while(stack.length){
    const d = stack.pop();
    let ents=[];
    try{ ents = fs.readdirSync(d,{withFileTypes:true}); } catch{ continue; }
    for(const e of ents){
      const p = path.join(d,e.name);
      if (e.isDirectory()) stack.push(p);
    }
    yield d;
  }
}
if (!exists(EVID)) {
  console.log('No public/evidence directory; nothing to normalize.');
  process.exit(0);
}

let created=0, reused=0, dirs=0;
for (const d of walk(EVID)){
  dirs++;
  const before = path.join(d,'before.txt');
  const after  = path.join(d,'after.txt');
  if (exists(before) && exists(after)) { reused++; continue; }

  // search for first matching pair per priority
  let pair=null, isHTML=false;
  for(const pr of RULES.pairs_priority){
    const a = path.join(d, pr[0]);
    const b = path.join(d, pr[1]);
    if (exists(a) && exists(b)) { pair=[a,b]; isHTML = pr[0].endsWith('.html'); break; }
  }
  if (!pair) continue;

  let [A,B] = pair;
  let ta = readFile(A), tb = readFile(B);
  if (isHTML || RULES.normalize.strip_html_tags){
    ta = stripTags(ta); tb = stripTags(tb);
  }
  ta = normalizeText(ta);
  tb = normalizeText(tb);
  fs.writeFileSync(before, ta, 'utf8');
  fs.writeFileSync(after,  tb, 'utf8');
  created++;
}
console.log(`normalize_pairs: created=${created} reused=${reused} scanned=${dirs}`);
