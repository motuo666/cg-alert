#!/usr/bin/env node
/**
 * scripts/discovery/endpoint_backoff_sweeper.js
 */
const fs = require('fs'); const path = require('path'); const https = require('https');
const { backoff, sleep } = require('./backoff_utils');
const ROOT = process.cwd();
const QUEUE_PATH = path.join('config','retry_queue.json');
const ENDPOINTS_PATH = path.join('config','endpoints.json');
const CONCURRENCY = parseInt(process.env.BACKOFF_CONCURRENCY||'8',10);
const PATHS = ['/pricing','/price','/plans','/terms','/legal/terms','/privacy','/dpa','/data-processing-addendum','/subprocessors','/security','/status','/sla','/legal','/policies','/docs'];

function loadJSON(p, def){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return def; } }
function saveJSON(p, obj){ fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, JSON.stringify(obj,null,2)); }

function head(url){
  return new Promise((resolve,reject)=>{
    const req = https.request(url, { method:'HEAD', timeout: 8000, headers: {'User-Agent':'CG-Alert/Sweeper'} }, res=>{ resolve(res.statusCode||0); res.resume(); });
    req.on('timeout', ()=>{ req.destroy(); reject(new Error('timeout')); });
    req.on('error', (e)=> reject(e));
    req.end();
  });
}

function collectCandidates(){
  const targetsCsv = path.join('config','targets.csv');
  const endpoints = loadJSON(ENDPOINTS_PATH, {});
  const queued = loadJSON(QUEUE_PATH, {});
  const all = new Set();
  if (fs.existsSync(targetsCsv)){
    const lines = fs.readFileSync(targetsCsv,'utf8').split(/\r?\n/).slice(1);
    for(const l of lines){ const d=(l.split(',')[0]||'').trim(); if(d) all.add(d); }
  }
  const out = [];
  for(const d of all){ if(!endpoints[d]) out.push(d); }
  for(const d of Object.keys(queued)) out.push(d);
  return [...new Set(out)].slice(0, 400);
}

async function probeDomain(d){
  const hits = [];
  for(const p of PATHS){
    const url = `https://${d}${p}`;
    try{
      const code = await backoff(()=>head(url), {tries:4, baseMs:400});
      if(code>=200 && code<400) hits.push(url);
    }catch{}
    await sleep(120);
  }
  return hits;
}

(async function run(){
  const endpoints = loadJSON(ENDPOINTS_PATH, {});
  const queue = loadJSON(QUEUE_PATH, {});
  const cands = collectCandidates();
  let idx=0;
  async function worker(){
    while(idx<cands.length){
      const d = cands[idx++];
      try{
        const hits = await probeDomain(d);
        if(hits.length){ endpoints[d] = hits; delete queue[d]; }
        else { const rec = queue[d] || {attempts:0}; rec.attempts += 1; rec.next = Date.now() + 24*3600*1000 * Math.min(rec.attempts, 7); queue[d] = rec; }
      }catch(e){ const rec = queue[d] || {attempts:0}; rec.attempts += 1; rec.next = Date.now() + 24*3600*1000 * Math.min(rec.attempts, 7); queue[d] = rec; }
    }
  }
  const workers = Array(Math.min(CONCURRENCY, cands.length)).fill(0).map(()=>worker());
  await Promise.all(workers);
  saveJSON(ENDPOINTS_PATH, endpoints);
  saveJSON(QUEUE_PATH, queue);
  console.log('sweeper: endpoints=', Object.keys(endpoints).length, 'queue=', Object.keys(queue).length);
})();