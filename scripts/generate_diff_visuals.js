#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EVID = path.join(ROOT, 'public', 'evidence');
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT,'config','diff_rules.json'),'utf8'));

function exists(p){ try { fs.accessSync(p); return true; } catch { return false; } }
function read(p){ return fs.readFileSync(p,'utf8'); }
function tokenize(s){ return s.split(/\s+/).filter(Boolean); }

// LCS-based word diff with stats
function diffWithStats(a,b){
  const A = tokenize(a), B = tokenize(b);
  const m=A.length, n=B.length;
  if (m+n > RULES.max_tokens){ return {html: `<p>Diff skipped: token cap exceeded (${m+n}).</p>`, ins:0, del:0, same:0}; }
  const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=m-1;i>=0;i--) for(let j=n-1;j>=0;j--) dp[i][j] = (A[i]===B[j]) ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
  let i=0,j=0,out=[],ins=0,del=0,same=0;
  while(i<m && j<n){
    if (A[i]===B[j]) { out.push(esc(A[i])); i++; j++; same++; }
    else if (dp[i+1][j] >= dp[i][j+1]) { out.push(`<del>${esc(A[i])}</del>`); i++; del++; }
    else { out.push(`<ins>${esc(B[j])}</ins>`); j++; ins++; }
  }
  while(i<m){ out.push(`<del>${esc(A[i++])}</del>`); del++; }
  while(j<n){ out.push(`<ins>${esc(B[j++])}</ins>`); ins++; }
  return {html:`<pre>${out.join(' ')}</pre>`, ins, del, same};
}
function esc(s){ return s.replace(/[&<>]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }

function metaOf(dir){
  const m = path.join(dir,'meta.json');
  if (!exists(m)) return null;
  try { return JSON.parse(read(m)); } catch { return null; }
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

if (!exists(EVID)) { console.log('No public/evidence directory; nothing to do.'); process.exit(0); }

let made=0, skipped=0;
for (const d of walk(EVID)){
  const before = path.join(d,'before.txt');
  const after  = path.join(d,'after.txt');
  if (!exists(before) || !exists(after)) { skipped++; continue; }
  const a = read(before), b = read(after);
  const {html, ins, del, same} = diffWithStats(a,b);
  const m = metaOf(d) || {};
  const css = `:root{--ink:#0b1020;--bg:#fff;--ins:#d1fae5;--del:#fee2e2;--muted:#6b7280}
body{font:16px/1.6 ui-sans-serif,system-ui,Segoe UI,Roboto,Arial;color:var(--ink);background:var(--bg);margin:0}
header{padding:16px 20px;border-bottom:1px solid #eee}
h1{margin:0;font-size:18px}
main{padding:20px}
ins{background:var(--ins);text-decoration:none;padding:0 .2em;border-radius:.2em}
del{background:var(--del);text-decoration:line-through;padding:0 .2em;border-radius:.2em}
pre{white-space:pre-wrap;word-wrap:break-word}
.stats{color:var(--muted);font-size:14px;margin-top:8px}`;
  const head = `<header><h1>Evidence Diff</h1><div class="stats">+${ins} / -${del} (unchanged ${same})${m.url?` · <a href="${m.url}" target="_blank" rel="nofollow">source</a>`:''}${m.timestamp?` · ${m.timestamp}`:''}</div></header>`;
  const htmlDoc = `<!doctype html><meta charset="utf-8"><title>Evidence Diff</title><style>${css}</style>${head}<main>${html}</main>`;
  fs.writeFileSync(path.join(d,'diff.html'), htmlDoc, 'utf8');
  fs.writeFileSync(path.join(d,'diff.json'), JSON.stringify({insertions:ins,deletions:del,unchanged:same,meta:m},null,2),'utf8');
  made++;
}
console.log(`Diff visuals: made=${made} skipped=${skipped}`);
