#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
function collect(){
  const urls = new Set([`${ORIGIN}/`, `${ORIGIN}/reports/`, `${ORIGIN}/dashboard/`]);
  const rep = 'reports';
  if(fs.existsSync(rep)){
    for(const ym of fs.readdirSync(rep)){
      const p = path.join(rep, ym);
      if(/^\d{4}-\d{2}$/.test(ym) && fs.statSync(p).isDirectory()){
        for(const v of fs.readdirSync(p)){
          const idx = path.join(p, v, 'index.html');
          if(fs.existsSync(idx)) urls.add(`${ORIGIN}/reports/${ym}/${encodeURIComponent(v)}/`);
        }
      }
    }
  }
  return Array.from(urls);
}
const urls = collect();
const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${u}</loc></url>`).join('')}</urlset>`;
fs.writeFileSync('sitemap.xml', xml, 'utf8');
console.log('sitemap urls:', urls.length);
