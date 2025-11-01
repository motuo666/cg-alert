#!/usr/bin/env node
// Auto-discover targets from: leads.csv(domain), customers.csv(domain), vendors/ dir names, and data/targets.csv fallback.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const ROOT = process.cwd(); const outBase = path.join(ROOT,'public','evidence'); fs.mkdirSync(outBase,{recursive:true});
function safeDomain(s){ s=String(s||'').trim().toLowerCase(); if(!s) return ''; s=s.replace(/^https?:\/\//,'').replace(/\/.*/,''); return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)?s:''; }
function readCSVDomains(p, col='domain'){
  try{
    const raw = fs.readFileSync(p,'utf8').trim().split(/\r?\n/); if (raw.length<2) return [];
    const H = raw.shift().split(','); const idx = H.findIndex(h=>h.trim().toLowerCase()===col);
    if (idx<0) return [];
    const out = [];
    for(const l of raw){ const a=l.split(','); const d=safeDomain(a[idx]||''); if(d) out.push(d); }
    return out;
  }catch(e){ return []; }
}
function readTargets(){
  const set = new Set();
  // leads.csv has header: email,name,title,company,domain,region,status
  for (const d of readCSVDomains(path.join(ROOT,'data','leads.csv'),'domain')) set.add(d);
  // customers.csv may also have domain column; try
  for (const d of readCSVDomains(path.join(ROOT,'data','customers.csv'),'domain')) set.add(d);
  // vendors/ dir names with dots treated as domain
  const vendors = path.join(ROOT,'vendors'); if (fs.existsSync(vendors)){ for(const v of fs.readdirSync(vendors)){ if (/\./.test(v)) set.add(v.toLowerCase()); } }
  // legacy targets.csv
  for (const d of readCSVDomains(path.join(ROOT,'data','targets.csv'),'vendor')) set.add(d);
  return Array.from(set);
}
async function fetchText(url){ try{ const r = await fetch(url); return {status:r.status, text: await r.text()}; } catch(e){ return {status:0, text:''}; } }
function sha(s){ return crypto.createHash('sha256').update(s).digest('hex'); }
function endpoints(d){ const b=`https://${d}`; return [b,b+'/pricing',b+'/terms',b+'/privacy',b+'/dpa',b+'/subprocessors',b+'/legal/terms',b+'/legal/privacy','https://status.'+d].slice(0,8); }
(async()=>{
  const targets = readTargets();
  if (!targets.length){ console.log('no targets auto-discovered'); process.exit(0); }
  let wrote=0;
  for(const v of targets){
    const dir = path.join(outBase,v); fs.mkdirSync(dir,{recursive:true});
    const idxPath = path.join(dir,'hashes.json'); let idx = {}; if (fs.existsSync(idxPath)){ try{ idx = JSON.parse(fs.readFileSync(idxPath,'utf8')); }catch(e){} }
    for(const u of endpoints(v)){
      const r = await fetchText(u); const h = sha((r.status||'')+':'+(r.text||'').slice(0,50000));
      if (idx[u] === h) continue;
      const rec = {vendor:v, url:u, status:r.status, hash:h, timestamp: Date.now()};
      fs.writeFileSync(path.join(dir, `${rec.timestamp}.json`), JSON.stringify(rec,null,2)); idx[u]=h; wrote++;
    }
    fs.writeFileSync(idxPath, JSON.stringify(idx,null,2));
  }
  console.log('wrote evidence:', wrote, 'targets:', targets.length);
})();
