#!/usr/bin/env node
// Simple evidence diff generator: scans public/evidence/** and writes diff.html if a before/after pair is found.
// Pairs recognized: before.txt+after.txt | old.txt+new.txt | prev.txt+curr.txt | prev.html+curr.html | content_old.txt+content_new.txt
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EVID = path.join(ROOT, 'public', 'evidence');

function exists(p){ try { fs.accessSync(p); return true; } catch { return false; } }
function readText(p){
  let t = fs.readFileSync(p, 'utf8');
  if (p.endsWith('.html')) t = t.replace(/<[^>]+>/g, ' '); // strip tags for html sources
  return t.replace(/\r\n/g, '\n');
}
function tokenize(s){ return s.split(/\s+/).filter(Boolean); }

// LCS-based diff (word-level), outputs HTML with <ins>/<del>
function diffHTML(a, b){
  const A = tokenize(a), B = tokenize(b);
  const m = A.length, n = B.length;
  const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=m-1;i>=0;i--) for(let j=n-1;j>=0;j--) dp[i][j] = A[i]===B[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
  let i=0, j=0, out=[];
  while(i<m && j<n){
    if (A[i]===B[j]) { out.push(A[i]); i++; j++; }
    else if (dp[i+1][j] >= dp[i][j+1]) { out.push(`<del>${escapeHTML(A[i])}</del>`); i++; }
    else { out.push(`<ins>${escapeHTML(B[j])}</ins>`); j++; }
  }
  while(i<m){ out.push(`<del>${escapeHTML(A[i++])}</del>`); }
  while(j<n){ out.push(`<ins>${escapeHTML(B[j++])}</ins>`); }
  const css = `body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Arial;line-height:1.6;padding:16px}
ins{background:#d1fae5;text-decoration:none;padding:0 .2em;border-radius:.2em}
del{background:#fee2e2;text-decoration:line-through;padding:0 .2em;border-radius:.2em}
pre{white-space:pre-wrap;word-wrap:break-word}`;
  return `<!doctype html><meta charset="utf-8"><title>Evidence Diff</title><style>${css}</style><h1>Evidence Diff</h1><pre>${out.join(' ')}</pre>`;
}
function escapeHTML(s){ return s.replace(/[&<>]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }

function findPair(dir){
  const pairs = [
    ['before.txt','after.txt'],
    ['old.txt','new.txt'],
    ['prev.txt','curr.txt'],
    ['prev.html','curr.html'],
    ['content_old.txt','content_new.txt'],
  ];
  for (const [a,b] of pairs){
    const pa = path.join(dir,a), pb = path.join(dir,b);
    if (exists(pa) && exists(pb)) return [pa,pb];
  }
  return null;
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
      else continue;
      yield p;
    }
  }
}

if (!exists(EVID)) {
  console.log('No public/evidence directory; nothing to do.');
  process.exit(0);
}

let made=0, skipped=0;
for (const d of walk(EVID)){
  const pair = findPair(d);
  if (!pair){ skipped++; continue; }
  const [a,b] = pair;
  const html = diffHTML(readText(a), readText(b));
  const out = path.join(d,'diff.html');
  fs.writeFileSync(out, html, 'utf8');
  made++;
}
console.log(`Diff visuals: made=${made} skipped=${skipped}`);
