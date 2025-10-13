#!/usr/bin/env node
const fs=require('fs'), path=require('path'), crypto=require('crypto'), https=require('https'), http=require('http');

const TARGET_TODAY = Math.max(30, Number(process.env.SEED_TODAY_MIN||30));
const PER_VENDOR_MAX = Math.max(2, Number(process.env.SEED_PER_VENDOR_MAX||2));
const MAX_ENDPOINTS = Math.max(3000, Number(process.env.SEED_MAX_ENDPOINTS||3000));
const TIMEOUT_MS = 12000;
const UA = "CGAlertBot/1.0 (+https://www.cg-alert.com/)";
const EP_FILE='data/endpoints.csv';

const today = ()=> new Date().toISOString().slice(0,10);
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const sha1   = s => crypto.createHash('sha1').update(s).digest('hex');
const isBadHost = h => /^(_seed|acme|example)\./i.test(h) || h==='example.com' || h.endsWith('.example.com');

function lines(p){ return fs.existsSync(p)?fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean):[]; }
function httpRequest(u, opt={}){
  return new Promise((resolve,reject)=>{
    const mod = u.startsWith('https:')?https:http;
    const req = mod.request(u, { method: opt.method||'GET', timeout: TIMEOUT_MS,
      headers: { 'user-agent': UA, 'accept': '*/*', ...(opt.headers||{}) }}, res=>{
        const bufs=[]; res.on('data',d=>bufs.push(d)); res.on('end',()=>resolve({res, body:Buffer.concat(bufs)}));
      });
    req.on('timeout',()=>req.destroy(new Error('timeout'))); req.on('error',reject); req.end();
  });
}
function parseEndpoints(){
  const rows = lines(EP_FILE); const out=[];
  for(const l of rows){
    const m = l.match(/https?:\/\/[^,\s]+/i); if(!m) continue;
    const url=m[0]; const u=new URL(url);
    const host=u.hostname.replace(/^www\./,'').toLowerCase();
    if(isBadHost(host)) continue;
    const type = l.split(',').slice(-1)[0]?.trim() || 'Baseline';
    out.push({ vendor: host, url, type });
    if(out.length>=MAX_ENDPOINTS) break;
  }
  return out;
}
function countToday(){
  if(!fs.existsSync('evidence')) return 0;
  let n=0;
  for(const d of fs.readdirSync('evidence',{withFileTypes:true})){
    if(!d.isDirectory()) continue;
    n += fs.readdirSync(path.join('evidence',d.name)).filter(f=>f.startsWith(today()+'-') && f.endsWith('.json')).length;
  }
  return n;
}
function vendorTodayCount(vendor){
  const dir=path.join('evidence',vendor);
  if(!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f=>f.startsWith(today()+'-') && f.endsWith('.json')).length;
}

async function seed(){
  if(!fs.existsSync(EP_FILE)) throw new Error('endpoints.csv missing');
  const eps = parseEndpoints();
  const q=new Map();
  for(const r of eps){
    if(countToday() >= TARGET_TODAY) break;
    const used=q.get(r.vendor)||0; if(used >= PER_VENDOR_MAX) continue;

    // 可选：抓 HEAD/GET 充实元数据（不影响 kind）
    let etag=null,last=null,body=null;
    try{
      let res = await httpRequest(r.url, {method:'HEAD'}).catch(()=>null);
      etag = res?.res?.headers?.etag||null; last = res?.res?.headers?.['last-modified']||null;
    }catch(e){}
    const dir=path.join('evidence',r.vendor); fs.mkdirSync(dir,{recursive:true});
    const urlHash=sha1(r.url).slice(0,8);
    const fname=`${today()}-${(r.type||'Baseline').replace(/\s+/g,'_')}-${urlHash}-00000000.json`;

    const obj={ vendor:r.vendor, type:(r.type||'Baseline'), url:r.url, kind:'baseline',
      detected_at:new Date().toISOString(), etag, last_modified:last, hash:null };

    fs.writeFileSync(path.join(dir,fname), JSON.stringify(obj,null,2),'utf8');
    q.set(r.vendor, used+1);
    console.log('[seed]', r.vendor, r.type||'Baseline', '→', fname);
  }
  console.log(`[seed] today=${countToday()}/${TARGET_TODAY}`);
}
seed().catch(e=>{ console.error(e); process.exit(1); });
