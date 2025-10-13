#!/usr/bin/env node
// internal_linking.js — 在 vendors/*、updates/index.html、reports/* 注入“相关厂商/按分类浏览”区块（幂等）
const fs=require('fs'), path=require('path');
const tagsFile=path.join('data','vendor_tags.csv'); const tagsMap={}; if(fs.existsSync(tagsFile)){
  for(const l of fs.readFileSync(tagsFile,'utf8').split(/\r?\n/).filter(Boolean)){
    const [v,t=''] = l.split(',').map(s=>s.trim()); if(v && t) (tagsMap[v] ||= []).push(t);
  }
}
function topRelated(slug, n=6){
  const cats=(tagsMap[slug]||[]); if(!cats.length) return [];
  const pool=new Set(); for(const [v,ts] of Object.entries(tagsMap)){ if(v===slug) continue; if(ts.some(x=>cats.includes(x))) pool.add(v); }
  return [...pool].sort().slice(0,n);
}
function injectRelated(file, slug){
  let html=fs.readFileSync(file,'utf8'); if(html.includes('data-cg-related="1"')) return;
  const rel=topRelated(slug); if(!rel.length) return;
  const block = `\n<section data-cg-related="1" style="margin-top:24px">
<h2 style="font-size:18px">Related vendors</h2>
<ul>${rel.map(v=>`<li><a href="/vendors/${encodeURIComponent(v)}/">${v}</a></li>`).join('')}</ul>
</section>\n`;
  html = html.replace(/<\/body>\s*<\/html>\s*$/i, m=> block + m);
  fs.writeFileSync(file, html, 'utf8'); console.log('related injected:', file);
}
function injectBrowse(file){
  let html=fs.readFileSync(file,'utf8'); if(html.includes('data-cg-browse="1"')) return;
  // 统计每类 Top 5
  const count={}; for(const ts of Object.values(tagsMap)) for(const t of ts) count[t]=(count[t]||0)+1;
  const topCats=Object.entries(count).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([t])=>t);
  if(!topCats.length) return;
  const lis=topCats.map(t=>`<li><a href="/categories/${encodeURIComponent(t.toLowerCase().replace(/\s+/g,'-'))}/">${t}</a></li>`).join('');
  const block=`\n<aside data-cg-browse="1" style="margin-top:24px"><h2 style="font-size:18px">Browse by category</h2><ul>${lis}</ul></aside>\n`;
  html = html.replace(/<\/body>\s*<\/html>\s*$/i, m=> block + m);
  fs.writeFileSync(file, html, 'utf8'); console.log('browse injected:', file);
}
(function main(){
  const V='vendors'; if(fs.existsSync(V)){
    for(const d of fs.readdirSync(V,{withFileTypes:true})){ if(!d.isDirectory()) continue;
      const slug=d.name; const idx=path.join(V,slug,'index.html'); if(fs.existsSync(idx)) injectRelated(idx, slug);
    }
  }
  const U=path.join('updates','index.html'); if(fs.existsSync(U)) injectBrowse(U);
  const R='reports'; if(fs.existsSync(R)){
    for(const ymd of fs.readdirSync(R,{withFileTypes:true})){
      if(!ymd.isDirectory()) continue;
      const idx=path.join(R, ymd.name, 'index.html'); if(fs.existsSync(idx)) injectBrowse(idx);
    }
  }
})();
