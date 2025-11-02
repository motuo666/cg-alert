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
  const lines = txt.split('\n').filter(Boolean);
  if(lines.length === 0) return [];
  const sep = (txt.indexOf('\t')>=0 && txt.indexOf(',')<0) ? '\t' : ',';
  const header = lines[0].split(sep).map(s=>s.trim().toLowerCase());
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const raw = lines[i];
    const cols = splitSmart(raw, sep);
    const obj = {};
    for(let j=0;j<header.length;j++) obj[header[j]] = (cols[j]||'').trim();
    rows.push(obj);
  }
  return rows;
}

function splitSmart(line, sep){
  const out = []; let cur = ''; let q = false;
  for(let i=0;i<line.length;i++){
    const c = line[i];
    if(c === '"'){ q = !q; cur += c; continue; }
    if(!q && c === sep){ out.push(cur); cur=''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function ensureDir(p){ fs.mkdirSync(p, {recursive:true}); }
function log(){ console.log('[cg]', ...arguments); }

module.exports = { findFirst, readCSVGuess, ensureDir, log };
