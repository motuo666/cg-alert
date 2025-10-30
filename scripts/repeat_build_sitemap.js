#!/usr/bin/env node
const fs = require('fs'), path = require('path');

function detectBase(fs){
  if (fs.existsSync('cg-alert-main/index.html')) return 'cg-alert-main';
  if (fs.existsSync('index.html')) return '.';
  if (fs.existsSync('cg-alert-main')) return 'cg-alert-main';
  return '.';
}

const BASE = detectBase(fs);
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
function collect(){
  const urls = new Set([`${ORIGIN}/`, `${ORIGIN}/reports/`, `${ORIGIN}/dashboard/`, `${ORIGIN}/who-uses/`, `${ORIGIN}/legal/terms.html`, `${ORIGIN}/legal/privacy.html`]);
  const rep = path.join(BASE, 'reports');
  if(fs.existsSync(rep)){
    for(const ym of fs.readdirSync(rep)){ const p = path.join(rep, ym);
      if(/^\d{4}-\d{2}$/.test(ym) && fs.statSync(p).isDirectory()){
        for(const v of fs.readdirSync(p)){
          const idx = path.join(p, v, 'index.html'); if(fs.existsSync(idx)) urls.add(`${ORIGIN}/reports/${ym}/${encodeURIComponent(v)}/`);
        }
      }
    }
  }
  return Array.from(urls);
}
const urls = collect();
const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${u}</loc></url>`).join('')}</urlset>`;
fs.writeFileSync(path.join(BASE,'sitemap.xml'), xml, 'utf8');
console.log('sitemap urls:', urls.length);
