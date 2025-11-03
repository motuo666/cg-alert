#!/usr/bin/env node
const fs=require('fs'), path=require('path');
function walk(d,f){ const out=[]; if(!fs.existsSync(d)) return out; for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) out.push(...walk(p,f)); else if(f(p)) out.push(p);} return out; }
function iso(ts){ return new Date(ts).toISOString(); }
const ROOT=process.cwd(), PUB=path.join(ROOT,'public'); const HOST=(process.env.SITE_ORIGIN||'https://www.cg-alert.com').replace(/\/$/,'');
const entries=new Set(['/','/pricing','/vendors/','/reports/','/rss','/terms','/privacy','/who-uses','/faq']);
for(const p of walk(path.join(PUB,'vendors'), p=>/index\.html$/i.test(p))){ const rel=p.replace(PUB,'').replace(/\\/g,'/'); entries.add(rel.replace(/\/index\.html$/i,'/')); }
let xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
for(const u of Array.from(entries)){ const full=path.join(PUB,u.replace(/^\//,'')); let m=Date.now(); try{ m=fs.statSync(full).mtimeMs }catch{};
  xml+=`  <url><loc>${HOST}${u}</loc><lastmod>${iso(m)}</lastmod><changefreq>daily</changefreq></url>\n`; }
xml+='</urlset>\n'; fs.writeFileSync(path.join(PUB,'sitemap.xml'), xml); console.log('sitemap:', entries.size);
