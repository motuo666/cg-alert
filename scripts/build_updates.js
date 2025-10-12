#!/usr/bin/env node
// build_updates.js — render /updates/index.html from recent evidence (simple list)
const fs=require('fs'), path=require('path');
function listRecent(limit=50){ const base='evidence', out=[]; if(!fs.existsSync(base)) return out;
  for(const d of fs.readdirSync(base,{withFileTypes:true})){ if(!d.isDirectory()) continue; const slug=d.name; const dir=path.join(base,slug);
    for(const f of fs.readdirSync(dir)){ if(!/\.json$/i.test(f)) continue; const p=path.join(dir,f); const st=fs.statSync(p); out.push({slug, when:st.mtime}); } }
  return out.sort((a,b)=>b.when-a.when).slice(0, limit);
}
(function main(){
  const items=listRecent(100).map(it=>`<li>${it.when.toISOString().slice(0,10)} — <a href="/vendors/${encodeURIComponent(it.slug)}/">${it.slug}</a></li>`).join('\n') || '<li>No recent updates.</li>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Updates — CG Alert</title></head><body><div class="wrap" style="max-width:720px;margin:0 auto;padding:28px 16px"><h1>Recent Updates</h1><ul>${items}</ul></div></body></html>`;
  const out = path.join('updates','index.html'); fs.mkdirSync('updates',{recursive:true}); fs.writeFileSync(out, html, 'utf8'); console.log('[updates] built');
})();