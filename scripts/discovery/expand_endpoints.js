#!/usr/bin/env node
/**
 * scripts/discovery/expand_endpoints.js (reinforced final)
 */
const fs = require('fs'); const path = require('path'); const https = require('https'); const { URL } = require('url');

const ROOT = process.cwd();
const CONCURRENCY = parseInt(process.env.EXPAND_CONCURRENCY||'12',10);
const TIMEOUT = parseInt(process.env.EXPAND_TIMEOUT_MS||'9000',10);
const KEY_PAGES = ['/pricing','/price','/plans','/terms','/legal/terms','/privacy','/dpa','/data-processing-addendum','/subprocessors','/security','/status','/sla','/legal','/policies','/docs'];
const KEYWORDS = ['terms','dpa','data-processing','processing','subprocessor','processor','privacy','security','sla','liability','master','msa','policy','policies'];

function readTargets(){
  const p = path.join(ROOT,'config','targets.csv');
  if(!fs.existsSync(p)) return [];
  return fs.readFileSync(p,'utf8').split(/\r?\n/).slice(1).map(l=>l.split(',')[0]).filter(Boolean);
}
function uniq(a){ return [...new Set(a)]; }

function head(url){
  return new Promise((resolve)=>{
    const u = new URL(url);
    const req = https.request(u, { method:'HEAD', timeout: TIMEOUT, headers: {'User-Agent':'CG-Alert/Autopilot'} }, res=>{ resolve(res.statusCode||0); res.resume(); });
    req.on('timeout', ()=>{ req.destroy(); resolve(0); });
    req.on('error', ()=> resolve(0));
    req.end();
  });
}
function get(url){
  return new Promise((resolve)=>{
    const u = new URL(url);
    const req = https.get(u, { timeout: TIMEOUT, headers: {'User-Agent':'CG-Alert/Autopilot'} }, res=>{
      let buf=''; res.setEncoding('utf8');
      res.on('data', d=> buf += d.length>200000 ? d.slice(0, 200000) : d);
      res.on('end', ()=> resolve({status:res.statusCode||0, body:buf}));
    });
    req.on('timeout', ()=>{ req.destroy(); resolve({status:0, body:''}); });
    req.on('error', ()=> resolve({status:0, body:''}));
  });
}
function sameHost(u, host){ try{ return new URL(u, `https://${host}`).host === host }catch{ return false } }

async function processDomain(d){
  const hits = new Set();
  for(const p of KEY_PAGES){ const url = `https://${d}${p}`; const code = await head(url); if(code>=200 && code<400) hits.add(url); }
  for(const p of ['/legal','/policies','/docs']){
    const url = `https://${d}${p}`; const res = await get(url);
    if(res.status>=200 && res.status<400 && res.body){
      const rx = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
      while((m=rx.exec(res.body))){
        const href = m[1]; const txt = (m[2]||'').toLowerCase();
        if(!sameHost(href, d)) continue;
        if(!KEYWORDS.some(k=>href.toLowerCase().includes(k) || txt.includes(k))) continue;
        let full = href; try { full = new URL(href, `https://${d}`).toString(); } catch {}
        const code = await head(full); if(code>=200 && code<400) hits.add(full);
      }
    }
  }
  return Array.from(hits);
}

async function run(){
  const domains = uniq(readTargets());
  const endpoints = {};
  let idx=0;
  async function worker(){
    while(idx<domains.length){
      const i = idx++; const d = domains[i];
      try{ const ok = await processDomain(d); if(ok.length) endpoints[d]=ok; }catch{}
    }
  }
  const workers = Array(Math.min(CONCURRENCY, domains.length)).fill(0).map(()=>worker());
  await Promise.all(workers);
  fs.mkdirSync('config',{recursive:true});
  fs.writeFileSync('config/endpoints.json', JSON.stringify(endpoints,null,2));
  fs.mkdirSync('artifacts',{recursive:true});
  fs.writeFileSync('artifacts/endpoints_count.txt', String(Object.keys(endpoints).length));
  console.log('domains with endpoints:', Object.keys(endpoints).length);
}
run().catch(e=>{ console.error(e); process.exit(1); });
