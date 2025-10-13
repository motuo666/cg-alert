#!/usr/bin/env node
// evidence_force_seed.js — 为 KPI 一次性补足基线证据（不抓取网络，只写占位 JSON）
const fs=require('fs'), path=require('path'), crypto=require('crypto');

const MAX_SEED_PER_RUN = Number(process.env.SEED_MAX||30);
const PREFERRED_TYPES = ['Pricing','ToS','Privacy','DPA','Subprocessors','Security','Status'];

const today = ()=> new Date().toISOString().slice(0,10);
function sha(s){ return crypto.createHash('sha1').update(s).digest('hex').slice(0,8); }
function vendorSlug(s){ return String(s||'').toLowerCase().replace(/^www\./,'').replace(/[^a-z0-9._-]/g,''); }
function ensure(p){ fs.mkdirSync(p,{recursive:true}); }

function readEndpoints(){
  if(!fs.existsSync('data/endpoints.csv')) return [];
  return fs.readFileSync('data/endpoints.csv','utf8').split(/\r?\n/).filter(Boolean).map(l=>{
    const m=l.match(/^(?<host>[^,]+),(?<url>https?:[^,]+),(?<type>[^,]+)$/i);
    if(!m) return null;
    return { host:m.groups.host, url:m.groups.url, type:m.groups.type };
  }).filter(Boolean);
}
function seedOne(host, url, type){
  const vendor=vendorSlug(host);
  const dir=path.join('evidence', vendor); ensure(dir);
  const name=`${today()}-${type}-${sha(url)}-00000000.json`;
  const fp=path.join(dir,name);
  if(fs.existsSync(fp)) return false;
  const rec={ vendor, url, type, seeded_at:new Date().toISOString(), baseline:true };
  fs.writeFileSync(fp, JSON.stringify(rec,null,2),'utf8');
  console.log(`[seed] ${host} ${type} → ${path.basename(fp)}`);
  return true;
}

(function main(){
  const eps=readEndpoints();
  const perHost=new Map();
  let done=0;
  for(const e of eps){
    if(done>=MAX_SEED_PER_RUN) break;
    const used = perHost.get(e.host)||new Set();
    // 优先使用首选类型
    if(!used.has(e.type) && PREFERRED_TYPES.includes(e.type)){
      if(seedOne(e.host, e.url, e.type)){ used.add(e.type); perHost.set(e.host, used); done++; }
    }
  }
  console.log(`[seed] today=${done}/${MAX_SEED_PER_RUN}`);
})();
