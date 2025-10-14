#!/usr/bin/env node
/**
* 将上月 evidence 打包到 artifacts/evidence-YYYY-MM.zip，并删除>90天的明细（索引仍保留）
* 上传发布交由 workflow 使用 upload-artifact/release-action 完成
*/
const fs = require('fs'), path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const EVD = path.join(ROOT, 'evidence');
const AR = path.join(ROOT, 'artifacts');


function ym(dt){ return dt.toISOString().slice(0,7); }
const now = new Date();
const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-1, 1));
const LAST = ym(last);


function* filesOfMonth(dir, ym){
if (!fs.existsSync(dir)) return;
for (const d of fs.readdirSync(dir, { withFileTypes:true })){
const p = path.join(dir, d.name);
if (d.isDirectory()) yield* filesOfMonth(p, ym);
else if (/\d{4}-\d{2}-\d{2}-/.test(d.name) && d.name.startsWith(ym)) yield p;
}
}


function zip(paths, out){
const list = paths.map(p=>`"${p}"`).join(' ');
execSync(`bash -lc "mkdir -p ${path.dirname(out)} && zip -q -9 -r \"${out}\" ${list}"`, { stdio:'inherit' });
}


(function main(){
const monthFiles = [...filesOfMonth(EVD, LAST)];
if (monthFiles.length){
const zipPath = path.join(AR, `evidence-${LAST}.zip`);
zip(monthFiles, zipPath);
console.log('artifact:', path.relative(ROOT, zipPath));
}
// 清理>90天
const threshold = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()-90));
(function clean(dir){
if (!fs.existsSync(dir)) return;
for (const d of fs.readdirSync(dir, { withFileTypes:true })){
const p = path.join(dir, d.name);
if (d.isDirectory()) clean(p); else {
const m = d.name.match(/^(\d{4}-\d{2}-\d{2})-/);
if (!m) continue;
})();
