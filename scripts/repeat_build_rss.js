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
const EVID = path.join(BASE,'evidence');
function* items(){
  if(!fs.existsSync(EVID)) return;
  for(const v of fs.readdirSync(EVID)){ const vd=path.join(EVID,v); if(!fs.statSync(vd).isDirectory()) continue;
    for(const cap of fs.readdirSync(vd)){ const idx = path.join(vd, cap, 'index0.html'); if(fs.existsSync(idx)) yield {v,cap}; }
  }
}
const list = Array.from(items()).slice(-100);
const body = list.map(it=>`<item><title>${it.v} ${it.cap}</title><link>${ORIGIN}/evidence/${encodeURIComponent(it.v)}/${encodeURIComponent(it.cap)}/index0.html</link></item>`).join('\n');
const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>CG Alert Feed</title><link>${ORIGIN}/</link>${body}</channel></rss>`;
fs.writeFileSync(path.join(BASE,'rss.xml'), xml, 'utf8');
console.log('rss items:', list.length);
