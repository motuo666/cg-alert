#!/usr/bin/env node
const fs=require('fs'), path=require('path');
function walk(d,f){ const out=[]; if(!fs.existsSync(d)) return out; for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) out.push(...walk(p,f)); else if(f(p)) out.push(p);} return out; }
function iso(ts){ return new Date(ts).toISOString(); }
const ROOT=process.cwd(), PUB=path.join(ROOT,'public'); const HOST=(process.env.SITE_ORIGIN||'https://www.cg-alert.com').replace(/\/$/,'');
const CORE=['/','/pricing','/vendors/','/reports/','/reports/metrics/','/rss','/terms','/privacy','/who-uses','/faq','/enterprise/','/channel/'];
function lastmod(u){ const full=path.join(PUB,u.replace(/^\//,'')); try{ return fs.statSync(full).mtimeMs }catch{ return Date.now(); } }
let xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
for(const u of CORE){ xml+=`  <url><loc>${HOST}${u}</loc><lastmod>${iso(lastmod(u))}</lastmod><changefreq>daily</changefreq></url>\n`; }
xml+='</urlset>\n'; fs.writeFileSync(path.join(PUB,'sitemap.xml'), xml);
const VROOT = path.join(PUB,'vendors');
const vendorPages = walk(VROOT, p=>/index\.html$/i.test(p)).map(p=>p.replace(PUB,'').replace(/\\/g,'/').replace(/\/index\.html$/i,'/'));
const CHUNK=5000;
if(vendorPages.length){
  const outDir=path.join(PUB,'sitemaps'); fs.mkdirSync(outDir,{recursive:true});
  const parts = Math.ceil(vendorPages.length/CHUNK);
  const indexXml=['<?xml version="1.0" encoding="UTF-8"?>','<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for(let i=0;i<parts;i++){
    const slice = vendorPages.slice(i*CHUNK,(i+1)*CHUNK);
    let sx = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for(const u of slice){ sx+=`  <url><loc>${HOST}${u}</loc><lastmod>${iso(lastmod(u))}</lastmod></url>\n`; }
    sx+='</urlset>\n';
    const fname = `sitemap-${i+1}.xml`; fs.writeFileSync(path.join(outDir,fname), sx);
    indexXml.push(`  <sitemap><loc>${HOST}/sitemaps/${fname}</loc><lastmod>${iso(Date.now())}</lastmod></sitemap>`);
  }
  indexXml.push('</sitemapindex>\n');
  fs.writeFileSync(path.join(PUB,'sitemap-index.xml'), indexXml.join('\n'));
}
console.log('sitemap updated, vendor pages:', vendorPages.length);
