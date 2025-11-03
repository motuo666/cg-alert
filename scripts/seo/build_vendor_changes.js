#!/usr/bin/env node
const fs=require('fs'), path=require('path');
function walk(d, cb){ if(!fs.existsSync(d)) return; for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) walk(p,cb); else cb(p); } }
function ensure(p){ fs.mkdirSync(path.dirname(p),{recursive:true}); }
function iso(d){ return new Date(d).toISOString().slice(0,10); }
function shell(t,b){ return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title><meta name="description" content="Timestamped vendor change evidence.">
<link rel="canonical" href="/"><meta name="robots" content="index,follow"><style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#0b1020;color:#e5e9ff}
header{padding:18px 16px;background:#0f1530;border-bottom:1px solid #26314a}h1{font-size:20px;margin:0}
main{max-width:980px;margin:18px auto;padding:0 16px 48px}.card{background:#121933;border:1px solid #26314a;border-radius:14px;padding:14px 16px;margin:14px 0}
a{color:#7fb3ff;text-decoration:none}.meta{opacity:.8;font-size:12px;margin:6px 0 0}ul{padding-left:18px}
</style><header><h1>${t}</h1></header><main>${b}</main>`; }
const ROOT=process.cwd(), EVID=path.join(ROOT,'public','evidence');
const endpointsPath=path.join(ROOT,'config','endpoints.json'); let endpoints={};
try{ endpoints=JSON.parse(fs.readFileSync(endpointsPath,'utf8')); }catch{ endpoints={}; }
const vendors=new Map();
walk(EVID,(p)=>{ const rel=path.relative(EVID,p); const parts=rel.split(path.sep); if(parts.length<2) return;
  const vendor=parts[0]; const st=fs.statSync(p); const d=iso(st.mtimeMs); const item={file:p,mtime:st.mtimeMs};
  if(!vendors.has(vendor)) vendors.set(vendor,new Map()); const m=vendors.get(vendor); if(!m.has(d)) m.set(d,[]); m.get(d).push(item);
});
let idx='';
for(const [vendor,days] of vendors.entries()){
  for(const [date,items] of days.entries()){
    let list=`<div class=card><b>${vendor}</b><div class=meta>Date: ${date} · Items: ${items.length}</div><ul>`;
    for(const it of items.slice(0,200)){ list+=`<li>${path.basename(it.file)}</li>`; } list+='</ul></div>';
    const eps=endpoints[vendor]||[]; if(eps.length){ list+=`<div class=card><b>Reference links</b><ul>`; for(const u of eps.slice(0,50)){ list+=`<li><a href="${u}">${u}</a></li>`; } list+='</ul></div>'; }
    const out=path.join(ROOT,'public','vendors',vendor,'changes',date,'index.html'); ensure(out); fs.writeFileSync(out, shell(`Vendor changes — ${vendor} — ${date}`, list));
  }
  const dates=Array.from(days.keys()).sort().reverse().slice(0,7);
  const link = dates[0]? `/vendors/${vendor}/changes/${dates[0]}/`:'#';
  idx += `<div class=card><a href="${link}">${vendor}</a><div class=meta>Recent: ${dates.join(', ')}</div></div>`;
}
if(idx){ const out=path.join(ROOT,'public','vendors','index.html'); ensure(out); fs.writeFileSync(out, shell('Vendors — Recent changes', idx)); }
console.log('done');
