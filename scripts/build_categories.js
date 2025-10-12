#!/usr/bin/env node
// build_categories.js — group vendors by tags from data/vendor_tags.csv
const fs=require('fs'), path=require('path');
function readTags(){ const p=path.join('data','vendor_tags.csv'); if(!fs.existsSync(p)) return {}; const lines=fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean);
  const map={}; for(const l of lines){ const [vendor,tag=''] = l.split(',').map(s=>s.trim()); if(!vendor||!tag) continue; (map[tag] ||= []).push(vendor); } return map;
}
(function main(){
  const tags=readTags(); const base='categories'; fs.mkdirSync(base,{recursive:true});
  for(const [tag, vendors] of Object.entries(tags)){ const file=path.join(base, tag.toLowerCase().replace(/\s+/g,'-'), 'index.html'); fs.mkdirSync(path.dirname(file), {recursive:true});
    const lis = vendors.sort().map(v=>`<li><a href="/vendors/${encodeURIComponent(v)}/">${v}</a></li>`).join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Category: ${tag}</title></head><body><div class="wrap" style="max-width:720px;margin:0 auto;padding:28px 16px"><h1>${tag}</h1><ul>${lis}</ul></div></body></html>`; fs.writeFileSync(file, html, 'utf8'); }
  console.log(`[categories] built ${Object.keys(tags).length} categories`);
})();