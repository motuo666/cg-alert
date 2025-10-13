#!/usr/bin/env node
/**
 * 公开端点轮询 -> evidence/*
 * - 以 URL 为准解析 vendor（避免 vendor 列里逗号导致错位）
 * - 文件名唯一：YYYY-MM-DD-Type-<url8>-<body8>.json，杜绝同名覆盖
 * - 跳过测试域：_seed.*, acme.*, example.*
 * - 遵守 robots；HEAD 条件请求，必要时 GET
 */
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
const sha1   = s => crypto.createHash('sha1').update(s).digest('hex');

const isBadHost = h => /^(_seed|acme|example)\./i.test(h) || h.endsWith('.example.com');

function parseLine(l){
  const m = l.match(/https?:\/\/[^,\s]+/i);
  if(!m) return null;
  const url = m[0];
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./,'').toLowerCase();
  if(isBadHost(host)) return null;
  const type = l.split(',').slice(-1)[0]?.trim() || '';
  return { vendor: host, url, type };
}

function readEndpoints(){
  if(!fs.existsSync(EP_FILE)) return [];
  const rows = fs.readFileSync(EP_FILE,'utf8').split(/\r?\n/).filter(Boolean);
  const parsed = rows.map(parseLine).filter(Boolean);
  // 限每 host 数量
  const used=new Map(), out=[];
  for(const r of parsed){
    const usedCnt = used.get(r.vendor)||0;
    if(usedCnt<PER_HOST){ out.push(r); used.set(r.vendor, usedCnt+1); }
    if(out.length>=MAX_ENDPOINTS) break;
  }
  return out;
}

function httpRequest(u, opt={}){
  return new Promise((resolve,reject)=>{
    const mod = u.startsWith('https:')?https:http;
    const req = mod.request(u, { method: opt.method||'GET', timeout: TIMEOUT_MS,
      headers: { 'user-agent': UA, 'accept': '*/*', ...(opt.headers||{}) }}, res=>{
        const bufs=[]; res.on('data',d=>bufs.push(d));
        res.on('end',()=>resolve({res, body:Buffer.concat(bufs)}));
      });
    req.on('timeout',()=>req.destroy(new Error('timeout')));
    req.on('error',reject);
    req.end();
  });
}

async function robotsAllowed(host, pathname){
  const cache = `.cache/robots/${host}.txt`; fs.mkdirSync(path.dirname(cache),{recursive:true});
  if(fs.existsSync(cache) && (Date.now()-fs.statSync(cache).mtimeMs) < 24*3600e3){
    return allowed(fs.readFileSync(cache,'utf8'), pathname);
  }
  try{
    const {res, body} = await httpRequest(`https://${host}/robots.txt`, {method:'GET'});
    if(res.statusCode>=200 && res.statusCode<300){
      fs.writeFileSync(cache, body);
      return allowed(body.toString('utf8'), pathname);
    }
  }catch(e){}
  fs.writeFileSync(cache,'');
  return allowed('', pathname);
}
function allowed(robots, pathname){
  const rows = robots.split(/\r?\n/);
  let ua='*', dis=[];
  for(const l of rows){
    const s=l.trim(); if(!s || s.startsWith('#')) continue;
    const m1=s.match(/^User-agent:\s*(.+)$/i); if(m1){ ua=m1[1].toLowerCase(); continue; }
    const m2=s.match(/^Disallow:\s*(.*)$/i); if(m2 && (ua==='*'||ua==='cgalertbot')) dis.push(m2[1]);
  }
  return !dis.some(p=>p && pathname.startsWith(p));
}

function vendorTodayCount(vendor){
  const dir=path.join('evidence',vendor);
  if(!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f=>f.startsWith(today()+'-') && f.endsWith('.json')).length;
}

async function processOne({vendor, url, type}){
  const u = new URL(url);
  if(!(await robotsAllowed(u.hostname, u.pathname))) return { skipped:true, reason:'robots' };

  const cache=`.cache/http/${u.hostname}/${Buffer.from(u.pathname).toString('base64url')}.json`;
  fs.mkdirSync(path.dirname(cache),{recursive:true});
  let c={}; if(fs.existsSync(cache)){ try{ c=JSON.parse(fs.readFileSync(cache,'utf8')); }catch{} }

  // 先 HEAD，再必要时 GET
  let head; try{
    head = await httpRequest(url, {method:'HEAD', headers:{
      ...(c.etag? {'if-none-match':c.etag}:{}),
      ...(c.lastModified? {'if-modified-since':c.lastModified}:{}),
    }});
  }catch(e){ /* 忽略，走 GET */ }
  let res=head;
  if(!res || !(res.res.statusCode>=200 && res.res.statusCode<400)){
    try{ res = await httpRequest(url, {method:'GET'}); }catch(e){ res=null; }
  }

  const etag = res?.res?.headers?.etag||c.etag||'';
  const last = res?.res?.headers?.['last-modified']||c.lastModified||'';
  const body = res?.body || Buffer.from('');
  const bodyHash = sha256(body).slice(0,8);

  fs.writeFileSync(cache, JSON.stringify({ etag, lastModified:last, hash: `sha256:${sha256(body)}`, checkedAt:new Date().toISOString() }, null, 2));

  // 文件名唯一：日期-类型-URL指纹-Body指纹.json
  const urlHash = sha1(url).slice(0,8);
  const tag = (type||'Baseline').replace(/\s+/g,'_');
  const dir = path.join('evidence', vendor);
  fs.mkdirSync(dir,{recursive:true});
  if(vendorTodayCount(vendor) >= VENDOR_DAILY_MAX) return { changed:true, coalesced:true };

  const fname = `${today()}-${tag}-${urlHash}-${bodyHash}.json`;
  const obj = { vendor, type: (type||'Baseline'), url, detected_at:new Date().toISOString(),
                etag: etag||null, last_modified: last||null, hash: body.length?`sha256:${sha256(body)}`:null };
  fs.writeFileSync(path.join(dir, fname), JSON.stringify(obj, null, 2),'utf8');
  return { changed:true, file:`evidence/${vendor}/${fname}` };
}

(async function main(){
  if(!fs.existsSync(EP_FILE)){ console.log('[poll] no endpoints.csv'); process.exit(0); }
  const eps = readEndpoints();
  let changed=0, skipped=0, errors=0;
  for(const r of eps){
    await new Promise(res=>setTimeout(res, 100));
    try{
      const t = await processOne(r);
      if(t.skipped) skipped++;
      else if(t.changed) { changed++; if(t.file) console.log('[poll][write]', t.file); }
    }catch(e){ errors++; console.error('[poll][err]', r.url, e.message); }
  }
  console.log(`[poll] done: batch=${eps.length}, changed=${changed}, skipped=${skipped}, errors=${errors}, VENDOR_DAILY_MAX=${VENDOR_DAILY_MAX}`);
})();
