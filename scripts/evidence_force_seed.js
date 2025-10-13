#!/usr/bin/env node
/**
 * 一次性把“今天”的 evidence 拉到目标值（公开端点 + robots）
 * - 以 URL 为准解析 vendor（避免逗号错位）
 * - 文件名唯一：YYYY-MM-DD-Type-<url8>-<body8>.json（不再被覆盖）
 * - 跳过 _seed.*, acme.*, example.*
 */
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
const isBadHost = h => /^(_seed|acme|example)\./i.test(h) || h.endsWith('.example.com');

function ensureFile(p, content){ fs.mkdirSync(path.dirname(p), {recursive:true}); if(!fs.existsSync(p)) fs.writeFileSync(p, content,'utf8'); }
function lines(p){ return fs.existsSync(p)?fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean):[]; }

function httpRequest(u, opt={}){
  return new Promise((resolve,reject)=>{
    const mod = u.startsWith('https:')?https:http;
    const req = mod.request(u, { method: opt.method||'GET', timeout: TIMEOUT_MS,
      headers: { 'user-agent': UA, 'accept': '*/*', ...(opt.headers||{}) }}, res=>{
        const bufs=[]; res.on('data',d=>bufs.push(d)); res.on('end',()=>resolve({res, body:Buffer.concat(bufs)}));
      });
    req.on('timeout',()=>req.destroy(new Error('timeout')));
    req.on('error',reject);
    req.end();
  });
}
function allowed(robots, pathname){
  const rows = robots.split(/\r?\n/); let ua='*', dis=[];
  for(const l of rows){
    const s=l.trim(); if(!s||s.startsWith('#')) continue;
    const m1=s.match(/^User-agent:\s*(.+)$/i); if(m1){ ua=m1[1].toLowerCase(); continue; }
    const m2=s.match(/^Disallow:\s*(.*)$/i); if(m2 && (ua==='*'||ua==='cgalertbot')) dis.push(m2[1]);
  }
  return !dis.some(p=>p && pathname.startsWith(p));
}
async function robotsAllowed(host, pathname){
  const cache = `.cache/robots/${host}.txt`; fs.mkdirSync(path.dirname(cache),{recursive:true});
  if(fs.existsSync(cache) && (Date.now()-fs.statSync(cache).mtimeMs)<24*3600e3) return allowed(fs.readFileSync(cache,'utf8'), pathname);
  try{ const {res, body}=await httpRequest(`https://${host}/robots.txt`,{method:'GET'});
       if(res.statusCode>=200 && res.statusCode<300){ fs.writeFileSync(cache,body); return allowed(body.toString('utf8'), pathname); } }
  catch(e){}
  fs.writeFileSync(cache,''); return allowed('', pathname);
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

function ensureDomainsAndEndpoints(){
  if(!fs.existsSync('data/domains.csv') || lines('data/domains.csv').length < 40){
    const seeds = [
      'stripe.com','cloudflare.com','twilio.com','slack.com','zoom.us','box.com','dropbox.com','atlassian.com',
      'datadoghq.com','pagerduty.com','okta.com','auth0.com','github.com','gitlab.com','vercel.com','netlify.com',
      'algolia.com','airtable.com','monday.com','sentry.io','notion.so','intercom.com','zendesk.com','freshworks.com',
      'segment.com','linear.app','supabase.com','render.com','hashicorp.com','snowflake.com','mongodb.com',
      'elastic.co','newrelic.com','confluent.io','openai.com','anthropic.com','huggingface.co','digitalocean.com',
      'heroku.com','salesforce.com','mailchimp.com','sendgrid.com','postmarkapp.com','fastly.com','amplitude.com'
    ];
    ensureFile('data/domains.csv', seeds.join('\n')+'\n');
  }
  try{ require('child_process').execSync('node scripts/endpoint_inventory.js', {stdio:'inherit'}); }catch{}
  if(!fs.existsSync(EP_FILE)) throw new Error('endpoints.csv missing');
}

function parseEndpoints(){
  const rows = lines(EP_FILE);
  const out=[];
  for(const l of rows){
    const m = l.match(/https?:\/\/[^,\s]+/i);
    if(!m) continue;
    const url=m[0]; const u=new URL(url);
    const host=u.hostname.replace(/^www\./,'').toLowerCase();
    if(isBadHost(host)) continue;
    const type = l.split(',').slice(-1)[0]?.trim() || '';
    out.push({ vendor: host, url, type });
    if(out.length>=MAX_ENDPOINTS) break;
  }
  return out;
}

async function seed(){
  ensureDomainsAndEndpoints();
  const eps = parseEndpoints();
  const q=new Map();
  for(const r of eps){
    if(countToday() >= TARGET_TODAY) break;
    const used = q.get(r.vendor)||0;
    if(used >= PER_VENDOR_MAX) continue;

    const u=new URL(r.url);
    if(!(await robotsAllowed(u.hostname, u.pathname))) continue;

    // 尝试拿头/体；失败也允许写“基线”（hash=null），但文件名带 URL 指纹确保唯一
    let etag='', last='', body=Buffer.from('');
    try{
      let res = await httpRequest(r.url, {method:'HEAD'}).catch(()=>null);
      etag = res?.res?.headers?.etag||''; last = res?.res?.headers?.['last-modified']||'';
      if(!etag && !last){
        res = await httpRequest(r.url, {method:'GET'}).catch(()=>null);
        etag = res?.res?.headers?.etag||etag; last = res?.res?.headers?.['last-modified']||last;
        body = res?.body || body;
      }
    }catch(e){}

    const dir=path.join('evidence',r.vendor); fs.mkdirSync(dir,{recursive:true});
    const tag=(r.type||'Baseline').replace(/\s+/g,'_');
    const urlHash=sha1(r.url).slice(0,8);
    const bodyHash=(body.length?sha256(body).slice(0,8):'00000000');
    const fname=`${today()}-${tag}-${urlHash}-${bodyHash}.json`;

    if(vendorTodayCount(r.vendor) >= PER_VENDOR_MAX) continue;

    const obj={ vendor:r.vendor, type:(r.type||'Baseline'), url:r.url,
      detected_at:new Date().toISOString(),
      etag: etag||null, last_modified: last||null,
      hash: body.length?`sha256:${sha256(body)}`:null };

    fs.writeFileSync(path.join(dir,fname), JSON.stringify(obj,null,2),'utf8');
    q.set(r.vendor, used+1);
    console.log('[seed]', r.vendor, r.type||'Baseline', '→', fname);
  }
  console.log(`[seed] today=${countToday()}/${TARGET_TODAY}`);
}

seed().catch(e=>{ console.error(e); process.exit(1); });
