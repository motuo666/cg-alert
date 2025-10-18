#!/usr/bin/env node
/**
 * sanitize_reports.js
 * 目标：把 reports/YYYY-MM/<vendor>/**/*.html 中指向 GitHub Actions 的 run 链接，
 *      替换为本站的快照索引页 /reports/proof/<vendor>/<YYYY-MM>/index.html。
 * 同时移除任何 data-run_url / run_id 等痕迹。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORTS = path.join(ROOT, 'reports');

function walk(dir, acc=[]){
  if(!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.isFile() && ent.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

function vendorYmFromPath(fp){
  //  .../reports/YYYY-MM/vendor/...
  const m = fp.replace(/\\/g,'/').match(/\/reports\/(\d{4}-\d{2})\/([^\/]+)\//);
  if (!m) return null;
  return { ym: m[1], vendor: m[2] };
}

function processFile(fp){
  const id = vendorYmFromPath(fp);
  if (!id) return false;

  let html = fs.readFileSync(fp, 'utf8');
  const before = html;

  // 1) 去掉 GH Actions run 超链接（任意文本）
  const ghRunRe = /<a\b[^>]*href="https:\/\/github\.com\/[^"]*actions\/runs\/[^"]+"[^>]*>.*?<\/a>/gi;
  const target = `/reports/proof/${id.vendor}/${id.ym}/index.html`;
  html = html.replace(ghRunRe, `<a href="${target}" target="_blank" rel="noopener">Snapshots</a>`);

  // 2) 清理残留属性
  html = html
    .replace(/\sdata-run_url="[^"]*"/gi, '')
    .replace(/\sdata-run-id="[^"]*"/gi, '')
    .replace(/\sdata-gh-run="[^"]*"/gi, '');

  if (html !== before){
    fs.writeFileSync(fp, html, 'utf8');
    return true;
  }
  return false;
}

function main(){
  const files = walk(REPORTS);
  let changed = 0;
  for (const f of files){
    try{
      if (processFile(f)) changed++;
    }catch(e){}
  }
  console.log(`sanitize_reports: updated ${changed} files under reports/`);
}
main();
