const fs=require('fs'),path=require('path'); const ROOT=path.join(__dirname,'..'); const SITE=process.env.SITE_ORIGIN||'https://www.cg-alert.com';
function readCSV(fp){ if(!fs.existsSync(fp))return{h:[],r:[]}; const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw)return{h:[],r:[]};
  const [h,...rs]=raw.split(/\r?\n/).filter(Boolean); const head=h.split(',').map(s=>s.trim());
  const rows=rs.map(l=>{const v=l.split(','); const o={}; head.forEach((k,i)=>o[k]=String(v[i]??'').trim()); return o;}); return{h:head,r:rows};}
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); const ensure=p=>fs.mkdirSync(p,{recursive:true});
function listV(){const d=path.join(ROOT,'evidence'); if(!fs.existsSync(d))return[]; return fs.readdirSync(d,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name);}
function loadV(v){const dir=path.join(ROOT,'evidence',v); if(!fs.existsSync(dir))return[]; return fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort().flatMap(f=>{
  const date=f.replace(/\.json$/,''); try{const j=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); const a=Array.isArray(j)?j:[j];
    return a.map(it=>({vendor:v, ts:new Date(it.timestamp||it.ts||(`${date}T00:00:00Z`)).toISOString(), url:it.url||it.URL||it.link||'', snippet:String(it.snippet||it.fragment||it.text||'')}));}catch{return[];}
}).sort((a,b)=>b.ts.localeCompare(a.ts));}
function feedXML(name, items){const its=items.slice(0,50).map(e=>`<item><title>${esc(e.vendor)} update</title><link>${esc(e.url)}</link><pubDate>${new Date(e.ts).toUTCString()}</pubDate><guid isPermaLink="false">${esc(e.vendor)}::${esc(e.ts)}</guid><description><![CDATA[${e.snippet.slice(0,2000)}]]></description></item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(name)} · CG Alert</title><link>${esc(SITE)}</link><description>Customer-specific feed</description>${its}</channel></rss>`;}
(function main(){
  const {h, r:cust}=readCSV(path.join(ROOT,'data','customers.csv')); if(cust.length===0) return;
  const api=path.join(ROOT,'api','customers'), html=path.join(ROOT,'customers'); ensure(api); ensure(html);
  const all=new Set(listV());
  for(const c of cust){
    const plan=(c.plan||c.tier||'').toLowerCase(); if(!plan.includes('enterprise')) continue;
    const id=(c.id||c.customer_id||c.email||c.company||'cust').replace(/[^a-z0-9_-]/gi,'_');
    const want=(c.vendors||'').split(/[, \t\r\n]+/).map(s=>s.trim()).filter(Boolean); if(want.length===0) continue;
    const pick=want.filter(v=>all.has(v)); if(pick.length===0) continue;
    let items=[]; for(const v of pick) items=items.concat(loadV(v)); items.sort((a,b)=>b.ts.localeCompare(a.ts));
    fs.writeFileSync(path.join(api,`${id}.json`), JSON.stringify({customer:id, vendors:pick, items:items.slice(0,200)},null,2),'utf8');
    fs.writeFileSync(path.join(html,`${id}_feed.xml`), feedXML(id, items),'utf8');
  }
  console.log('build_customer_feeds: done');
})();
