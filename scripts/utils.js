// scripts/utils.js (CommonJS)
const fs = require('fs');
const path = require('path');

function findFirst(paths){
  for(const p of paths){
    if(fs.existsSync(p)) return p;
  }
  return null;
}

function readCSVGuess(file){
  const txt = fs.readFileSync(file, 'utf8').replace(/\r\n/g,'\n').trim();
  if(!txt) return [];
  const lines = txt.split('\n').filter(Boolean);
  const sep = (txt.indexOf('\t')>=0 && txt.indexOf(',')<0) ? '\t' : ',';
  const head = parseLine(lines[0], sep);
  const out = [];
  for(let i=1;i<lines.length;i++){
    const row = parseLine(lines[i], sep);
    const o = {};
    for(let j=0;j<head.length;j++){
      const k = (head[j]||'').trim();
      if(!k) continue;
      o[k] = row[j]||'';
    }
    out.push(o);
  }
  return out;
}

function parseLine(line, sep){
  const out = []; let cur = ''; let q = false;
  for(let i=0;i<line.length;i++){
    const c = line[i];
    if(c === '"'){ q = !q; continue; } // drop quotes
    if(!q && c === sep){ out.push(cur); cur=''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function ensureDir(p){ fs.mkdirSync(p, {recursive:true}); }
function log(){ console.log('[cg]', ...arguments); }

module.exports = { findFirst, readCSVGuess, ensureDir, log };
