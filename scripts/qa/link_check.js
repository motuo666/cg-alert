#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{const p=path.join(d,e.name);return e.isDirectory()?walk(p):/\.(html?)$/i.test(e.name)?[p]:[]});}
function hrefs(s){const r=[];const re=/<a\s+[^>]*href=["']([^"']+)["']/ig;let m;while((m=re.exec(s)))r.push(m[1]);return r;}
const ROOT=process.cwd(), broken=[];
for(const f of walk(ROOT)){const h=hrefs(fs.readFileSync(f,'utf8'));for(const u of h){if(/^(https?:|mailto:|tel:|#)/i.test(u))continue;let t=u.startsWith('/')?path.join(ROOT,u.replace(/^\//,'')):path.join(path.dirname(f),u);t=t.split('#')[0].split('?')[0];if(!fs.existsSync(t))broken.push({file:path.relative(ROOT,f),href:u});}}
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/link_report.json',JSON.stringify({broken},null,2));
fs.writeFileSync('artifacts/link_report.txt',broken.map(b=>`${b.file} -> ${b.href}`).join('\n'));
console.log('link_check: broken internal links =',broken.length);
if(broken.length>0)process.exit(1);
