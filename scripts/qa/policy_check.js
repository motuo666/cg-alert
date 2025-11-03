#!/usr/bin/env node
const fs=require('fs'); const path=require('path');
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{const p=path.join(d,e.name);return e.isDirectory()?walk(p):/\.(html?)$/i.test(e.name)?[p]:[]});}
function has(s,rx){return rx.test(s)}
const ROOT=process.cwd(), warns=[];
if(!fs.existsSync(path.join(ROOT,'robots.txt'))) warns.push('robots.txt missing');
if(!fs.existsSync(path.join(ROOT,'sitemap.xml'))) warns.push('sitemap.xml missing');
for(const f of walk(ROOT)){const s=fs.readFileSync(f,'utf8');
  if(!has(s,/<link\s+[^>]*rel=["']canonical["'][^>]*>/i)) warns.push(`canonical missing: ${path.relative(ROOT,f)}`);
  if(!has(s,/<meta\s+[^>]*name=["']description["'][^>]*>/i)) warns.push(`meta description missing: ${path.relative(ROOT,f)}`);
}
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/policy_check.json',JSON.stringify({warnings:warns},null,2));
console.log('policy_check: warnings =',warns.length);
process.exit(0);
