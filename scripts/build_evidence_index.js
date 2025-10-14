#!/usr/bin/env node
/**
* 扫描 evidence/<slug>/<YYYY-MM-DD>-<Type>-<hash>.json → 生成 data/evidence.ndx（TSV）
* 列：date slug type hash path
*/
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const EVD = path.join(ROOT, 'evidence');
const OUT = path.join(ROOT, 'data', 'evidence.ndx');


function* walk(dir){
if (!fs.existsSync(dir)) return;
for (const d of fs.readdirSync(dir, { withFileTypes:true })){
const p = path.join(dir, d.name);
if (d.isDirectory()) yield* walk(p); else yield p;
}
}


function main(){
fs.mkdirSync(path.dirname(OUT), { recursive:true });
const lines = [];
for (const f of walk(EVD)){
if (!/\.json$/i.test(f)) continue;
const rel = path.relative(ROOT, f).replace(/\\/g,'/');
const m = rel.match(/^evidence\/(.+?)\/(\d{4}-\d{2}-\d{2})-([A-Za-z]+)-([a-f0-9]{6,})\.json$/);
if (!m) continue;
const [, slug, date, type, hash] = m;
lines.push([date, slug, type, hash, rel].join('\t'));
}
lines.sort();
fs.writeFileSync(OUT, lines.join('\n') + (lines.length?'\n':''), 'utf8');
console.log(`indexed: ${lines.length} records -> ${path.relative(ROOT, OUT)}`);
}
main();
