#!/usr/bin/env node
/**
 * poll_public_endpoints.js — 轮询公开端点变更 -> evidence/*
 * - 仅公共页面；遵守 robots.txt （UA: CGAlertBot）
 * - 轻量：优先 HEAD，再 GET; If-Modified-Since / If-None-Match
 * - 缓存：.cache/http/<host>/<b64path>.json 存 etag/last/hash
 * - 变更判定：ETag/Last-Modified 变化或内容 SHA256 变化
 */
const fs=require('fs'), path=require('path'), crypto=require('crypto'), https=require('https'), http=require('http'), { URL } = require('url');

const EP_FILE='data/endpoints.csv';
const UA = "CGAlertBot/1.0 (+https://www.cg-alert.com/)";
const MAX_ENDPOINTS = Number(process.env.MAX_ENDPOINTS||300);
const PER_HOST = Number(process.env.PER_HOST||4);
const TIMEOUT_MS = 15000;

function lines(f){ return fs.existsSync(f)?fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean):[]; }
function b64(s){ return Buffer.from(s).toString('base64url'); }
function httpGet(u, opt={}){
  return new Promise((resolve,reject)=>{
    const url = new URL(u);
    const mod = url.protocol==='https:'?https:http;
    const req = mod.request(u, { method: opt.method||'GET',
      headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml', ...(opt.headers||{}) },
      timeout: TIMEOUT_MS
    }, res=>{ const bufs=[]; res.on('data',d=>bufs.push(d)); res.on('end',()=>resolve({res, body:Buffer.concat(bufs)})); });
    req.on('timeout',()=>{ req.destroy(new Error('timeout')); });
    req.on('error',reject); req.end();
  });
}

async function fetchRobots(host){
  const cache = `.cache/robots/${host}.txt`; fs.mkdirSync(path.dirname(cache),{recursive:true});
  if(fs.existsSync(cache) && (Date.now()-fs.statSync(cache).mtimeMs) < 24*3600e3){
    return fs.readFileSync(cache,'utf8');
  }
  try{
    const {res, body} = await httpGet(`https://${host}/robots.txt`, {method:'GET'});
    if(res.statusCode>=200 && res.statusCode<300) { fs.writeFileSync(cache, body); return body.toString('utf8'); }
  }catch(e){}
  fs.writeFileSync(cache, ''); return '';
}
function isAllowed(robots, pathname){
  // 极简解析：读取针对 CGAlertBot 或 * 的 Disallow 列表，若命中前缀则不抓
  const lines = robots.split(/\r?\n/);
  let ua = '*', blocks = [];
  for(const l of lines){
    const s=l.trim(); if(!s || s.startsWith('#')) continue;
    const m = s.match(/^User-agent:\s*(.+)$/i); if(m){ ua=m[1].toLowerCase(); continue; }
    const d = s.match(/^Disallow:\s*(.*)$/i); if(d && (ua==='*' || ua==='cgalertbot')) blocks.push(d[1]);
  }
  return !blocks.some(b => b && pathname.startsWith(b));
}

function cachePath(host, pathname){
  return `.cache/http/${host}/${b64(pathname)}.json`;
}
function sha256(buf){ return crypto.createHash('sha256').update(buf).digest('hex'); }

async function checkOne(vendor, urlStr, type){
  const url = new URL(urlStr);
  const robots = await fetchRobots(url.hostname);
  if(!isAllowed(robots, url.pathname)){ return { skipped:true, reason:'robots' }; }

  const cpath = cachePath(url.hostname, url.pathname); fs.mkdirSync(path.dirname(cpath), {recursive:true});
  let cache = {}; if(fs.existsSync(cpath)) { try{ cache=JSON.parse(fs.readFileSync(cpath,'utf8')); }catch{} }

  // 先 HEAD
  let head; try{
    head = await httpGet(urlStr, { method:'HEAD', headers:{
      ...(cache.etag? {'if-none-match': cache.etag}:{}),
      ...(cache.lastModified? {'if-modified-since': cache.lastModified}:{}),
    }});
  }catch(e){ return { error:e.message }; }

  if(head.res.statusCode===304){ return { changed:false, notModified:true }; }
  let etag=head.res.headers.etag||'', last=head.res.headers['last-modified']||'';

  // 需要 GET 正文及 hash（某些站不支持 HEAD/条件头）
  let bodyRes=head; if(head.res.statusCode>=400 || !head.res.headers.etag && !head.res.headers['last-modified']){
    try{ bodyRes = await httpGet(urlStr, { method:'GET' }); }catch(e){ return { error:e.message }; }
    etag = bodyRes.res.headers.etag||etag; last = bodyRes.res.headers['last-modified']||last;
  }
  if(!bodyRes.body || !bodyRes.body.length){
    try{ bodyRes = await httpGet(urlStr, { method:'GET' }); }catch(e){ return { error:e.message }; }
  }
  const hash = sha256(bodyRes.body);

  const changed = (etag && etag!==cache.etag) || (last && last!==cache.lastModified) || (hash && hash!==cache.hash);
  fs.writeFileSync(cpath, JSON.stringify({ etag, lastModified:last, hash, checkedAt:new Date().toISOString() }, null, 2));

  if(!changed) return { changed:false };

  // 生成 evidence
  const slug = vendor;
  const day = new Date().toISOString().slice(0,10);
  const evDir = path.join('evidence', slug); fs.mkdirSync(evDir, {recursive:true});
  const fname = `${day}-${type || 'Public change'}-${hash.slice(0,12)}.json`;
  const ev = {
    vendor: slug, type: type||'Public change', url: urlStr,
    detected_at: new Date().toISOString(),
    etag: etag||null, last_modified: last||null, hash: `sha256:${hash}`
  };
  fs.writeFileSync(path.join(evDir, fname), JSON.stringify(ev, null, 2), 'utf8');
  return { changed:true, file: `evidence/${slug}/${fname}` };
}

function limitPerHost(rows){
  const map=new Map(); const out=[];
  for(const r of rows){
    const host = new URL(r.url).hostname;
    const arr = map.get(host) || []; if(arr.length<PER_HOST){ out.push(r); arr.push(1); map.set(host, arr); }
    if(out.length>=MAX_ENDPOINTS) break;
  }
  return out;
}

(async function main(){
  if(!fs.existsSync(EP_FILE)){ console.log('[poll] no endpoints.csv'); process.exit(0); }
  const rows = lines(EP_FILE).map(l=>{ const [vendor,url,type] = l.split(','); return {vendor,url,type}; })
    .filter(r=>/^https?:\/\//.test(r.url));
  const batch = limitPerHost(rows);
  let changed=0, skipped=0, errors=0;
  for(const r of batch){
    // 轻微退避
    await new Promise(res=>setTimeout(res, 120));
    try{
      const t = await checkOne(r.vendor, r.url, r.type);
      if(t.skipped) skipped++; else if(t.error){ errors++; console.error('[poll][err]', r.url, t.error); }
      else if(t.changed){ changed++; console.log('[poll][changed]', t.file); }
    }catch(e){ errors++; console.error('[poll][err]', r.url, e.message); }
  }
  console.log(`[poll] done: batch=${batch.length}, changed=${changed}, skipped=${skipped}, errors=${errors}`);
})();
