#!/usr/bin/env node
const fs = require('fs'), path = require('path');
function readLines(p){ try{ return fs.readFileSync(p,'utf8').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);}catch{ return []; } }
const outPath = 'config/blacklist/domains_auto.txt';
const free = new Set(readLines('config/free_mail_domains.txt'));
const manual = new Set(readLines('config/blacklist/domains_manual.txt'));
const bounceCsv = readLines('reports/bounce/domains.csv').map(x=>x.split(',')[0].trim().toLowerCase()).filter(Boolean);
const bounce = new Set(bounceCsv);
const merged = new Set([...free, ...manual, ...bounce]);
const out = Array.from(merged).sort().join('\n') + '\n';
let cur = '';
try{ cur = fs.readFileSync(outPath,'utf8'); }catch{}
if (cur !== out){
  fs.mkdirSync(path.dirname(outPath), {recursive:true});
  fs.writeFileSync(outPath, out);
  console.log('blacklist updated', merged.size);
} else {
  console.log('blacklist unchanged', merged.size);
}
