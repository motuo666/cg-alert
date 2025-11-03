#!/usr/bin/env node
/**
 * scripts/discovery/discover_targets.js (reinforced final)
 */
const fs = require('fs'); const path = require('path'); const https = require('https'); const { URL } = require('url');

const DRY = (process.env.DRY||'false').toLowerCase()==='true';
const MAX_NEW = parseInt(process.env.DISCOVERY_MAX||'200',10);
const CONCURRENCY = parseInt(process.env.DISCOVERY_CONCURRENCY||'12',10);
const PER_HOST_DELAY_MS = parseInt(process.env.DISCOVERY_PER_HOST_DELAY_MS||'200',10);
const ROOT = process.cwd();

function readLines(p){ if(!fs.existsSync(p)) return []; return fs.readFileSync(p,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean); }
function uniq(a){ return [...new Set(a)]; }
function isDomain(s){ return /^[a-z0-9.-]+\.[a-z.]{2,}$/.test(s) }

function loadSeeds(){
  const seeds = new Set();
  const seedTxt = path.join(ROOT,'data','seed_domains.txt');
  const targetsCsv = path.join(ROOT,'config','targets.csv');
  readLines(seedTxt).forEach(d=>{ if(!d.startsWith('#') && isDomain(d)) seeds.add(d) });
  if(fs.existsSync(targetsCsv)){
    fs.readFileSync(targetsCsv,'utf8').split(/\r?\n/).slice(1).forEach(line=>{
      const [domain] = line.split(',');
      if(isDomain(domain)) seeds.add(domain.trim());
    });
  }
  return seeds;
}

function parseBlacklist(){
  const list = readLines(path.join(ROOT,'config','blacklist.txt'));
  return list.map(s=>s.replace(/^\*\./,'').toLowerCase());
}
function blacklisted(domain, bl){ domain = domain.toLowerCase(); return bl.some(x => domain===x || domain.endsWith('.'+x)); }

function loadRegionFilter(){ try { return JSON.parse(fs.readFileSync(path.join(ROOT,'config','region_filter.json'),'utf8')); } catch { return {mode:'off'}; } }
function tldOf(domain){ const parts = domain.split('.'); return parts[parts.length-1]; }
function passRegion(domain, cfg){
  if(!cfg || cfg.mode==='off') return true;
  const tld = tldOf(domain);
  if(cfg.mode==='allow'){ if(cfg.tld_allow && !cfg.tld_allow.includes(tld)) return false; }
  else if(cfg.mode==='deny'){ if(cfg.tld_deny && cfg.tld_deny.includes(tld)) return false; }
  const d = domain.toLowerCase();
  if(cfg.domain_allow_keywords?.length){ const ok = cfg.domain_allow_keywords.some(k=>d.includes(k)); if(!ok) return false; }
  if(cfg.domain_deny_keywords?.length){ if(cfg.domain_deny_keywords.some(k=>d.includes(k))) return false; }
  return true;
}

function loadPersona(){ try { return JSON.parse(fs.readFileSync(path.join(ROOT,'config','persona_rules.json'),'utf8')); } catch { return {mode:'any'}; } }
function passPersona(domain, cfg){
  if(!cfg || cfg.mode==='any') return true;
  const d=domain.toLowerCase();
  if(cfg.mode==='include'){ const ok = (cfg.include_keywords||[]).some(k=>d.includes(k)); if(!ok) return false; }
  if(cfg.mode==='exclude'){ if((cfg.exclude_keywords||[]).some(k=>d.includes(k))) return false; }
  return true;
}

function fromSources(){
  const dir = path.join(ROOT,'discovery','sources');
  const out = [];
  if(fs.existsSync(dir)){
    for(const f of fs.readdirSync(dir)){ if(/\.txt$/i.test(f)) out.push(...readLines(path.join(dir,f)).filter(isDomain)); }
  }
  return uniq(out);
}

function companyFromDomain(d){ let s=d.replace(/^www\./,''); s=s.split('.')[0]; s=s.replace(/[-_]/g,' '); return s.charAt(0).toUpperCase()+s.slice(1); }

function fetch(url, method='HEAD', timeout=8000){
  return new Promise((resolve)=>{
    const u = new URL(url);
    const opts = { method, timeout, headers: { 'User-Agent': 'CG-Alert/Autopilot' } };
    const req = https.request(u, opts, res=>{ resolve({status:res.statusCode||0}); res.resume(); });
    req.on('timeout', ()=>{ req.destroy(); resolve({status:0}); });
    req.on('error', ()=> resolve({status:0}));
    req.end();
  });
}

async function fetchRobots(host){
  try{
    const r = await fetch(`https://${host}/robots.txt`, 'GET', 5000);
    if (r.status<200 || r.status>=400) return {allowAll:true};
    const text = await new Promise(res=>{
      const https = require('https'); const u = `https://${host}/robots.txt`;
      let buf=''; https.get(u, {timeout:5000}, s=>{ s.setEncoding('utf8'); s.on('data',d=>buf+=d); s.on('end',()=>res(buf)); }).on('error',()=>res(''));
    });
    const lines = text.split(/\r?\n/);
    const disallow = []; let uaStar=false;
    for(const ln of lines){
      const mUA = ln.match(/^\s*User-agent:\s*(.+)/i);
      if(mUA){ uaStar = /\*/.test(mUA[1]); continue; }
      if(uaStar){
        const mD = ln.match(/^\s*Disallow:\s*(.*)/i);
        if(mD) disallow.push(mD[1].trim());
      }
    }
    return {allowAll:false, disallow};
  }catch{ return {allowAll:true}; }
}

function allowedByRobots(robots, path){ if(!robots || robots.allowAll) return true; for(const rule of robots.disallow||[]){ if(!rule) continue; if(path.startsWith(rule)) return false; } return true; }

async function probeDomain(d){
  const robots = await fetchRobots(d).catch(()=>({allowAll:true}));
  const PATHS = ['/', '/pricing','/price','/plans','/terms','/legal/terms','/privacy','/dpa','/data-processing-addendum','/subprocessors','/security','/status'];
  for(const p of PATHS){
    if(!allowedByRobots(robots, p)) continue;
    const {status} = await fetch(`https://${d}${p}`, 'HEAD', 8000);
    if(status>=200 && status<400) return true;
    await new Promise(r=>setTimeout(r, PER_HOST_DELAY_MS));
  }
  return false;
}

async function run(){
  const seeds = loadSeeds();
  const sources = fromSources();
  const bl = parseBlacklist();
  const rf = loadRegionFilter();
  const pr = loadPersona();

  const pool = sources.filter(d=>!seeds.has(d))
    .filter(d=>!blacklisted(d, bl))
    .filter(d=>passRegion(d, rf))
    .filter(d=>passPersona(d, pr));

  const chosen = [];
  let idx=0;
  async function worker(){
    while(idx<pool.length && chosen.length<MAX_NEW){
      const d = pool[idx++];
      try{ const ok = await probeDomain(d); if(ok) chosen.push(d); }catch{}
    }
  }
  const workers = Array(Math.min(CONCURRENCY, pool.length)).fill(0).map(()=>worker());
  await Promise.all(workers);

  const stamp = new Date().toISOString().slice(0,10);
  const seedPath = path.join(ROOT,'data','seed_domains.txt');
  const targetsPath = path.join(ROOT,'config','targets.csv');
  const seedLines = fs.existsSync(seedPath) ? fs.readFileSync(seedPath,'utf8').split(/\r?\n/) : [];
  const append = [`# discovered ${stamp}`, ...chosen];
  const newSeeds = (seedLines.join('\n') + '\n' + append.join('\n')).replace(/\n{3,}/g,'\n\n');
  if(!DRY){ fs.mkdirSync(path.dirname(seedPath), {recursive:true}); fs.writeFileSync(seedPath, newSeeds.trim()+'\n'); }

  const header = 'domain,company,region';
  let rows = [header];
  if(fs.existsSync(targetsPath)){
    const lines = fs.readFileSync(targetsPath,'utf8').split(/\r?\n/).filter(Boolean);
    if(lines[0].trim().toLowerCase().startsWith('domain,')) rows = [lines[0], ...lines.slice(1)];
    else rows = [header, ...lines];
  }
  const existing = new Set(rows.slice(1).map(l=>l.split(',')[0]));
  for(const d of chosen){ if(existing.has(d)) continue; rows.push(`${d},${companyFromDomain(d)},Global`); }
  if(!DRY){ fs.mkdirSync(path.dirname(targetsPath), {recursive:true}); fs.writeFileSync(targetsPath, rows.join('\n')+'\n'); }

  const report = { discovered: chosen.length, sample: chosen.slice(0,20) };
  fs.mkdirSync('artifacts',{recursive:true});
  fs.writeFileSync('artifacts/discovery.json', JSON.stringify(report,null,2));
  console.log('discovered:', chosen.length);
}
run().catch(e=>{ console.error(e); process.exit(1); });
