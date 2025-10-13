#!/usr/bin/env node
/**
 * poll_public_endpoints.js — 轮询公开端点变更 -> evidence/*
 * - 只抓公开页；遵守 robots.txt（UA: CGAlertBot）
 * - 先 HEAD(条件请求) 再 GET；If-Modified-Since / If-None-Match
 * - 首次无缓存时，生成“Baseline”证据（保证可开门禁）
 * - ★ 每 vendor 每天最多落 N 条（VENDOR_DAILY_MAX，默认 2）
 */
const fs=require('fs'), path=require('path'), crypto=require('crypto'), https=require('https'), http=require('http'), { URL } = require('url');

const EP_FILE='data/endpoints.csv';
const UA = "CGAlertBot/1.0 (+https://www.cg-alert.com/)";
const MAX_ENDPOINTS = Number(process.env.MAX_ENDPOINTS||500);
const PER_HOST = Number(process.env.PER_HOST||5);
const VENDOR_DAILY_MAX = Math.max(1, Number(process.env.VENDOR_DAILY_MAX||2));
const TIMEOUT_MS = 15000;

function lines(f){ return fs.existsSync(f)?fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean):[]; }
function b64(s){ return Buffer.from(s).toString('base64url'); }
function sha256(buf){ return crypto.createHash('sha256').update(buf).digest('hex'); }

function httpGet(u, opt={}){
  return new Promise((resolve,reject)=>{
    const mod = u.startsWith('https:')?https:http;
    const req = mod.request(u, { method: opt.method||'GET',
      headers: { 'user-agent': UA, 'accept': '*/*', ...(opt.headers||{}) },
      timeout: TIMEOUT_MS
    }, res=>{ const bufs=[]; res.on('data',d=>bufs.push(d)); res.on('end',()=>resolve({res, body:Buffer.concat(bufs)})); });
    req.on('timeout',()=>{ req.destroy(new Error('timeout')); });
    req.on('error',reject); req.end();
  });
}

async function fetchRobots(host){
  const cache = `.cache/robots/${host}.txt`; fs.mkdirSync(path.dirname(cache),{recursive:true});
  if(fs.existsSync(cache) && (Date.now()-fs.statSync(cache).mtimeMs) < 24*3600e3) return fs.readFileSync(cache,'utf8');
  try{
    const {res, body} = await httpGet(`https://${host}/robots.txt`, {method:'GET'});
    if(res.statusCode>=200 && res.statusCode<300){ fs.writeFileSync(cache, body); return body.toString('utf8'); }
  }catch(e){}
  fs.writeFileSync(cache, ''); return '';
}

function isAllowed(robots, pathname){
  // 简易 robots：读 * 或 cgalertbot 的 Disallow 前缀
  const rows = robots.split(/\r?\n/);
  let ua='*', blocks=[];
  for(const l of rows){
    const s=l.trim(); if(!s || s.startsWith('#')) continue;
    const m1=s.match(/^User-agent:\s*(.+)$/i); if(m1){ ua=m1[1].toLowerCase(); continue; }
    const m2=s.match(/^Disallow:\s*(.*)$/i); if(m2 && (ua==='*'||ua==='cgalertbot')) blocks.push(m2[1]);
  }
  return !blocks.some(b=>b && pathname.startsWith(b));
}

function cachePath(host, pathname){ return `.cache/http/${host}/${b64(pathname)}.json`; }

function today(){ return new Date().toISOString().slice(0,10); }
function vendorTodayCount(evDir){
  if(!fs.existsSync(evDir)) return 0;
  const d=today(); return fs.readdirSync(evDir).filter(f=>f.startsWith(d+'-') && f.endsWith('.json')).length;
}

async function checkOne(vendor, urlStr, type){
  const url = new URL(urlStr);
  const robots = await fetchRobots(url.hostname);
  if(!isAllowed(robots, url.pathname)) return { skipped:true, reason:'robots' };

  const cpath = cachePath(url.hostname, url.pathname); fs.mkdirSync(path.dirname(cpath), {recursive:true});
  let cache={}; if(fs.existsSync(cpath)) { try{ cache=JSON.parse(fs.readFileSync(cpath,'utf8')); }catch{} }

  // HEAD 带条件头
  let head; try{
    head = await httpGet(urlStr, { method:'HEAD', headers:{
      ...(cache.etag? {'if-none-match': cache.etag}:{}),
      ...(cache.lastModified? {'if-modified-since': cache.lastModified}:{}),
    }});
  }catch(e){ return { error:e.message }; }

  if(!(head.res.statusCode>=200 && head.res.statusCode<400)){
    head = await httpGet(urlStr, { method:'GET' }).catch(()=>head);
  }

  // 拿正文（首次或需要比较时）
  let res=head, etag=head?.res?.headers?.etag||'', last=head?.res?.headers?.['last-modified']||'';
  if(!res || !res.body || !res.body.length || head.res.statusCode===304){
    try{ res = await httpGet(urlStr, {method:'GET'}); etag=res.res.headers.etag||etag; last=res.res.headers['last-modified']||last; }catch(e){ return { error:e.message }; }
  }
  const hash = sha256(res.body||Buffer.from(''));

  const firstRun = !cache.hash && !cache.etag && !cache.lastModified;
  const changed = firstRun || (etag && etag!==cache.etag) || (last && last!==cache.lastModified) || (hash && hash!==cache.hash);

  // 更新缓存
  fs.writeFileSync(cpath, JSON.stringify({ etag, lastModified:last, hash, checkedAt:new Date().toISOString() }, null, 2));

  if(!changed) return { changed:false };

  // ★ 每 vendor 每天最多 N 条
  const evDir = path.join('evidence', vendor);
  const count = vendorTodayCount(evDir);
  if(count >= VENDOR_DAILY_MAX) return { changed:true, coalesced:true };

  fs.mkdirSync(evDir, {recursive:true});
  const tag = firstRun ? 'Baseline' : (type||'Public change');
  const fname = `${today()}-${tag}-${hash.slice(0,10)}.json`;
  const ev = { vendor, type: tag, url: urlStr, detected_at: new Date().toISOString(),
               etag: etag||null, last_modified: last||null, hash: `sha256:${hash}` };
  fs.writeFileSync(path.join(evDir, fname), JSON.stringify(ev, null, 2), 'utf8');
  return { changed:true, file:`evidence/${vendor}/${fname}`, firstRun };
}

function limitPerHost(rows){
  const map=new Map(), out=[];
  for(const r of rows){
    const host = new URL(r.url).hostname;
    const used = map.get(host)||0;
    if(used<PER_HOST){ out.push(r); map.set(host, used+1); }
    if(out.length>=MAX_ENDPOINTS) break;
  }
  return out;
}

(async function main(){
  if(!fs.existsSync(EP_FILE)){ console.log('[poll] no endpoints.csv'); process.exit(0); }
  const rows = lines(EP_FILE).map(l=>{ const [vendor,url,type] = l.split(','); return {vendor,url,type}; })
    .filter(r=>r.vendor && /^https?:\/\//.test(r.url));
  const batch = limitPerHost(rows);
  let changed=0, baselines=0, skipped=0, errors=0;
  for(const r of batch){
    await new Promise(res=>setTimeout(res, 120));
    try{
      const t = await checkOne(r.vendor, r.url, r.type);
      if(t.skipped) skipped++;
      else if(t.error){ errors++; console.error('[poll][err]', r.url, t.error); }
      else if(t.changed){ changed++; if(t.firstRun) baselines++; if(t.file) console.log('[poll][write]', t.file); }
    }catch(e){ errors++; console.error('[poll][err]', r.url, e.message); }
  }
  console.log(`[poll] done: batch=${batch.length}, changed=${changed}, baselines=${baselines}, skipped=${skipped}, errors=${errors}, VENDOR_DAILY_MAX=${VENDOR_DAILY_MAX}`);
})();
