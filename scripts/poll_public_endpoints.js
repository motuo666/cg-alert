#!/usr/bin/env node
// poll_public_endpoints.js — 轮询 endpoints.csv，尊重 robots.txt，发现变化入 evidence/<vendor>/YYYY-MM-DD-*.json
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const https=require('https'), http=require('http');

const EP_FILE='data/endpoints.csv';
const UA="CGAlertBot/1.0 (+https://www.cg-alert.com/)";
const MAX_ENDPOINTS=Number(process.env.MAX_ENDPOINTS||500);
const PER_HOST=Number(process.env.PER_HOST||5);
const VENDOR_DAILY_MAX=Math.max(1, Number(process.env.VENDOR_DAILY_MAX||2));
const TIMEOUT_MS=15000;

const today = ()=> new Date().toISOString().slice(0,10);
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const isBadHost = h => /^(_seed|acme|example)\./i.test(h) || h==='example.com' || h.endsWith('.example.com');

function parseCSV(){
  if(!fs.existsSync(EP_FILE)) return [];
  const rows = fs.readFileSync(EP_FILE,'utf8').split(/\r?\n/).filter(Boolean);
  return rows.map(l=>{
    const m = l.match(/^(?<host>[^,]+),(?<url>https?:[^,]+),(?<type>[^,]+)$/i);
    if(!m) return null;
    const host=m.groups.host.trim().toLowerCase();
    const url=m.groups.url.trim();
    const type=m.groups.type.trim();
    return { host, url, type, vendor: host.replace(/^www\./,'') };
  }).filter(Boolean).filter(r=>!isBadHost(r.host));
}
function chooseSubset(list){
  const used=new Map(), out=[];
  for(const r of list){
    const k=r.vendor; const c=used.get(k)||0;
    if(c<PER_HOST){ out.push(r); used.set(k,c+1); }
    if(out.length>=MAX_ENDPOINTS) break;
  }
  return out;
}
function httpRequest(u, opt={}){
  return new Promise((resolve,reject)=>{
    const mod = u.startsWith('https:')?https:http;
    const req = mod.request(u, { method: opt.method||'GET', timeout: TIMEOUT_MS,
      headers: { 'user-agent': UA, 'accept': '*/*', ...(opt.headers||{}) }}, res=>{
        const bufs=[]; res.on('data',d=>bufs.push(d)); res.on('end',()=>resolve({res, body:Buffer.concat(bufs)}));
      });
    req.on('timeout',()=>req.destroy(new Error('timeout'))); req.on('error',reject);
    req.end();
  });
}
async function robotsAllow(u){
  try{
    const url=new URL(u);
    const robots=`${url.protocol}//${url.host}/robots.txt`;
    const {res, body}=await httpRequest(robots);
    if(res.statusCode!==200) return true;
    const txt=body.toString('utf8');
    const lines=txt.split(/\r?\n/).map(s=>s.trim());
    let uaOK=false;
    for(const line of lines){
      if(/^User-agent:\s*\*/i.test(line)){ uaOK=true; continue; }
      if(/^User-agent:/i.test(line)){ uaOK=false; continue; }
      if(uaOK && /^Disallow:/i.test(line)){
        const rule=line.replace(/^Disallow:/i,'').trim();
        if(!rule) continue;
        if(url.pathname.startsWith(rule)) return false;
      }
    }
    return true;
  }catch{ return true; }
}
function writeEvidence(vendor, url, type, bodyBuf){
  const dir=path.join('evidence', vendor); fs.mkdirSync(dir,{recursive:true});
  const h=sha256(bodyBuf).slice(0,8);
  const date=today();
  const name=`${date}-${type}-${h}.json`;
  const fp=path.join(dir,name);
  if(fs.existsSync(fp)) return false;
  const rec={ vendor, url, type, fetched_at:new Date().toISOString(), sha256: sha256(bodyBuf) };
  fs.writeFileSync(fp, JSON.stringify(rec,null,2),'utf8');
  return true;
}
(async function main(){
  const list = chooseSubset(parseCSV());
  let changed=0, errors=0;
  const dailyCounter=new Map();
  for(const r of list){
    const v=r.vendor;
    const count=(dailyCounter.get(v)||0);
    if(count>=VENDOR_DAILY_MAX) continue;
    if(!(await robotsAllow(r.url))) { continue; }
    try{
      const {res, body}=await httpRequest(r.url);
      if((res.statusCode||0)>=200 && (res.statusCode||0)<400){
        if(writeEvidence(v, r.url, r.type, body)){ dailyCounter.set(v, count+1); changed++; }
      }else{
        errors++;
        console.error(`[poll][err] ${r.url} status ${res.statusCode}`);
      }
    }catch(e){
      errors++;
      console.error(`[poll][err] ${r.url} ${e.message}`);
    }
  }
  console.log(`[poll] done: batch=${list.length}, changed=${changed}, errors=${errors}, VENDOR_DAILY_MAX=${VENDOR_DAILY_MAX}`);
})(); 
