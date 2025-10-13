#!/usr/bin/env node
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const https=require('https'), http=require('http'), zlib=require('zlib');

const EP_FILE='data/endpoints.csv';
const UA="CGAlertBot/1.0 (+https://www.cg-alert.com/)";
const MAX_ENDPOINTS=Number(process.env.MAX_ENDPOINTS||500);
const PER_HOST=Number(process.env.PER_HOST||5);
const VENDOR_DAILY_MAX=Math.max(1, Number(process.env.VENDOR_DAILY_MAX||2));
const TIMEOUT_MS=15000;
const SAVE_BODY = process.env.SAVE_BODY === '1';        // 可选：保存归一化正文到 .cache，便于后续自动扩域

const today = ()=> new Date().toISOString().slice(0,10);
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const sha1   = s => crypto.createHash('sha1').update(s).digest('hex');
const isBadHost = h => /^(_seed|acme|example)\./i.test(h) || h==='example.com' || h.endsWith('.example.com');

function normalizeBody(buf){
  // 轻量去噪：日期/时间/utm/nonce/动态data-attr
  let s = buf.toString('utf8');
  s = s.replace(/\b20\d{2}-\d{2}-\d{2}\b/g,'{DATE}')
       .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g,'{TIME}')
       .replace(/utm_[a-z]+=[^&"'<> ]+/gi,'utm_param')
       .replace(/nonce="[A-Za-z0-9\-_]+"/gi,'nonce="{N}"')
       .replace(/data-[a-z\-]+="[^"]*"/gi, 'data-attr="{X}"');
  return Buffer.from(s,'utf8');
}

function parseLine(l){
  const m = l.match(/https?:\/\/[^,\s]+/i); if(!m) return null;
  const url = m[0];
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./,'').toLowerCase();
  if(isBadHost(host)) return null;
  const type = l.split(',').slice(-1)[0]?.trim() || 'Baseline';
  return { vendor: host, url, type };
}

function readEndpoints(){
  if(!fs.existsSync(EP_FILE)) return [];
  const rows = fs.readFileSync(EP_FILE,'utf8').split(/\r?\n/).filter(Boolean);
  const parsed = rows.map(parseLine).filter(Boolean);
  const used=new Map(), out=[];
  for(const r of parsed){
    const c=used.get(r.vendor)||0;
    if(c<PER_HOST){ out.push(r); used.set(r.vendor,c+1); }
    if(out.length>=MAX_ENDPOINTS) break;
  }
  return out;
}

function decompress(body, enc){
  try{
    if(!body || !body.length || !enc) return body;
    enc = String(enc).toLowerCase();
    if(enc.includes('br')) return zlib.brotliDecompressSync(body);
    if(enc.includes('gzip')) return zlib.gunzipSync(body);
    if(enc.includes('deflate')) return zlib.inflateSync(body);
  }catch(e){}
  return body;
}

function httpRequest(u, opt={}){
  return new Promise((resolve,reject)=>{
    const mod = u.startsWith('https:')?https:http;
    const req = mod.request(u, {
      method: opt.method||'GET',
      timeout: TIMEOUT_MS,
      headers: {
        'user-agent': UA,
        'accept': '*/*',
        'accept-encoding': 'gzip, br, deflate',
        ...(opt.headers||{})
      }
    }, res=>{
      const bufs=[]; res.on('data',d=>bufs.push(d));
      res.on('end',()=>{
        let body=Buffer.concat(bufs);
        body = decompress(body, res.headers['content-encoding']);
        resolve({res, body});
      });
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

function vendorTodayCount(v){
  const dir=path.join('evidence',v); if(!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f=>f.startsWith(today()+'-') && f.endsWith('.json')).length;
}

async function processOne({vendor, url, type}){
  const u = new URL(url);
  if(!(await robotsAllowed(u.hostname, u.pathname))) return { skipped:true, reason:'robots' };

  const cacheBase = `.cache/http/${u.hostname}/${Buffer.from(u.pathname).toString('base64url')}`;
  const cacheJSON = `${cacheBase}.json`;
  const cacheBODY = `${cacheBase}.body.txt`;
  fs.mkdirSync(path.dirname(cacheJSON),{recursive:true});
  let c={}; if(fs.existsSync(cacheJSON)){ try{ c=JSON.parse(fs.readFileSync(cacheJSON,'utf8')); }catch{} }

  // HEAD 优先，必要时 GET
  let head; try{
    head = await httpRequest(url, {method:'HEAD', headers:{
      ...(c.etag? {'if-none-match':c.etag}:{}),
      ...(c.lastModified? {'if-modified-since':c.lastModified}:{}),
    }});
  }catch(e){}
  let res=head;
  if(!res || !(res.res.statusCode>=200 && res.res.statusCode<400)){
    try{ res = await httpRequest(url, {method:'GET'}); }catch(e){ res=null; }
  }

  const etag = res?.res?.headers?.etag||null;
  const last = res?.res?.headers?.['last-modified']||null;

  let body = res?.body || Buffer.from('');
  if(body.length) body = normalizeBody(body);
  const bodyHash = body.length ? sha256(body) : null;

  // 与历史缓存比对
  const prevHash = c?.hash || null;       // 形如 sha256:xxxx
  const prevEtag = c?.etag || null;
  const prevLast = c?.lastModified || null;

  const changed = Boolean(
    (bodyHash && prevHash !== `sha256:${bodyHash}`) ||
    (etag && etag !== prevEtag) ||
    (last && last !== prevLast)
  );

  // 更新缓存
  fs.writeFileSync(cacheJSON, JSON.stringify({
    etag: etag || prevEtag || null,
    lastModified: last || prevLast || null,
    hash: bodyHash ? `sha256:${bodyHash}` : (prevHash||null),
    checkedAt: new Date().toISOString()
  }, null, 2));

  // 可选：保存归一化正文（仅 Runner 工作区；<300KB 才存）
  if(SAVE_BODY && body && body.length && body.length < 300*1024){
    try{ fs.writeFileSync(cacheBODY, body); }catch(e){}
  }

  if(!changed){
    // 无变化且已有基线就不再写盘
    const dir=path.join('evidence',vendor);
    if(fs.existsSync(dir) && fs.readdirSync(dir).some(f=>f.includes(sha1(url).slice(0,8)))){
      return { changed:false };
    }
  }

  const urlHash = sha1(url).slice(0,8);
  const tag = (type||'Baseline').replace(/\s+/g,'_');
  const dir = path.join('evidence', vendor); fs.mkdirSync(dir,{recursive:true});
  if(vendorTodayCount(vendor) >= VENDOR_DAILY_MAX && changed) return { changed:true, coalesced:true };

  const fname = `${today()}-${tag}-${urlHash}-${(bodyHash||'00000000').slice(0,8)}.json`;
  const obj = {
    vendor, type:(type||'Baseline'), url,
    kind: changed ? 'change' : 'baseline',
    detected_at:new Date().toISOString(),
    etag: etag || null, last_modified: last || null,
    hash: bodyHash ? `sha256:${bodyHash}` : null
  };
  fs.writeFileSync(path.join(dir, fname), JSON.stringify(obj, null, 2),'utf8');
  return { changed:true, file:`evidence/${vendor}/${fname}` };
}

(async function main(){
  if(!fs.existsSync(EP_FILE)){ console.log('[poll] no endpoints.csv'); process.exit(0); }
  const eps = readEndpoints();
  let changed=0, skipped=0, errors=0;
  for(const r of eps){
    await new Promise(res=>setTimeout(res,100)); // 轻节流
    try{
      const t = await processOne(r);
      if(t?.skipped) skipped++;
      else if(t?.changed) { changed++; if(t.file) console.log('[poll][write]', t.file); }
    }catch(e){ errors++; console.error('[poll][err]', r.url, e.message); }
  }
  console.log(`[poll] done: batch=${eps.length}, changed=${changed}, skipped=${skipped}, errors=${errors}, VENDOR_DAILY_MAX=${VENDOR_DAILY_MAX}`);
})();
