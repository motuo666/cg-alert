#!/usr/bin/env node
// evidence_force_seed.js — 一次性把“今天”的 evidence 拉到目标值（公开端点 + robots + HEAD/GET）
// 合规：只抓公开页面；尊重 robots.txt；每 vendor 最多 2 条；产生 JSON 证据（带 etag/last-modified/sha256）
const fs=require('fs'), path=require('path'), crypto=require('crypto'), https=require('https'), http=require('http'), { URL } = require('url');

const TARGET_TODAY = Math.max(30, Number(process.env.SEED_TODAY_MIN||30)); // 今天至少 30 条
const PER_VENDOR_MAX = Math.max(2, Number(process.env.SEED_PER_VENDOR_MAX||2));
const MAX_ENDPOINTS = Math.max(3000, Number(process.env.SEED_MAX_ENDPOINTS||3000));
const TIMEOUT_MS = 12000;
const UA = "CGAlertBot/1.0 (+https://www.cg-alert.com/)";

function today(){ return new Date().toISOString().slice(0,10); }
function ensureFile(p, content){ fs.mkdirSync(path.dirname(p), {recursive:true}); if(!fs.existsSync(p)) fs.writeFileSync(p, content, 'utf8'); }
function lines(p){ return fs.existsSync(p)?fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean):[]; }
function sha256(buf){ return crypto.createHash('sha256').update(buf).digest('hex'); }

function httpGet(u, opt={}){
  return new Promise((resolve,reject)=>{
    const mod = u.startsWith('https:')?https:http;
    const req = mod.request(u, { method: opt.method||'GET',
      headers: { 'user-agent': UA, 'accept': '*/*', ...(opt.headers||{}) }, timeout: TIMEOUT_MS
    }, res=>{ const bufs=[]; res.on('data',d=>bufs.push(d)); res.on('end',()=>resolve({res, body:Buffer.concat(bufs)})); });
    req.on('timeout',()=>req.destroy(new Error('timeout'))); req.on('error',reject); req.end();
  });
}
async function fetchRobots(host){
  const cache = `.cache/robots/${host}.txt`; fs.mkdirSync(path.dirname(cache),{recursive:true});
  if(fs.existsSync(cache) && (Date.now()-fs.statSync(cache).mtimeMs)<24*3600e3) return fs.readFileSync(cache,'utf8');
  try{ const {res, body} = await httpGet(`https://${host}/robots.txt`,{method:'GET'});
       if(res.statusCode>=200 && res.statusCode<300){ fs.writeFileSync(cache, body); return body.toString('utf8'); } }catch(e){}
  fs.writeFileSync(cache,''); return '';
}
function allowed(robots, pathn){
  const rs=robots.split(/\r?\n/); let ua='*', dis=[];
  for(const l of rs){ const s=l.trim(); if(!s||s.startsWith('#')) continue;
    const m1=s.match(/^User-agent:\s*(.+)$/i); if(m1){ ua=m1[1].toLowerCase(); continue; }
    const m2=s.match(/^Disallow:\s*(.*)$/i); if(m2 && (ua==='*'||ua==='cgalertbot')) dis.push(m2[1]); }
  return !dis.some(p=>p && pathn.startsWith(p));
}
function countToday(){ const base='evidence'; if(!fs.existsSync(base)) return 0;
  let n=0; for(const d of fs.readdirSync(base,{withFileTypes:true})) if(d.isDirectory()){
    n += fs.readdirSync(path.join('evidence',d.name)).filter(f=>f.startsWith(today()+'-') && f.endsWith('.json')).length;
  } return n;
}
function vendorTodayCount(v){ const dir=path.join('evidence',v); if(!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f=>f.startsWith(today()+'-') && f.endsWith('.json')).length;
}

// 更大的默认种子池（保证首次就能拉满）
const DEFAULT_DOMAINS = [
  'stripe.com','cloudflare.com','twilio.com','slack.com','zoom.us','box.com','dropbox.com','atlassian.com',
  'datadoghq.com','pagerduty.com','okta.com','auth0.com','github.com','gitlab.com','vercel.com','netlify.com',
  'algolia.com','airtable.com','monday.com','sentry.io','notion.so','intercom.com','zendesk.com','freshworks.com',
  'datadog.com','segment.com','linear.app','supabase.com','render.com','hashicorp.com','snowflake.com','mongodb.com',
  'elastic.co','newrelic.com','confluent.io','openai.com','anthropic.com','huggingface.co','digitalocean.com',
  'heroku.com','salesforce.com','mailchimp.com','sendgrid.com','postmarkapp.com','statuspage.io','status.io',
  'fastly.com','cloudfront.net','smartlook.com','mixpanel.com','heap.io','posthog.com','segment.com','launchdarkly.com',
  'featureflag.co','appcues.com','amplitude.com','braze.com','clevertap.com','iterable.com','loom.com','miro.com','figma.com'
];

function ensureDomainsAndEndpoints(){
  const norm = s => s.replace(/^https?:\/\//,'').replace(/\/+$/,'').toLowerCase();
  if(!fs.existsSync('data/domains.csv') || lines('data/domains.csv').length < 40){
    const uniq=[...new Set(DEFAULT_DOMAINS.map(norm))];
    ensureFile('data/domains.csv', uniq.join('\n')+'\n');
  }
  // 生成端点
  try{ require('child_process').execSync('node scripts/endpoint_inventory.js', {stdio:'inherit'}); }catch(e){
    // 兜底：直接用常见路径生成 endpoints.csv
    const PATHS=['/pricing','/plans','/terms','/privacy','/legal/privacy','/dpa','/legal/dpa','/subprocessors','/sub-processors','/security','/trust','/.well-known/security.txt','/status'];
    const domains=lines('data/domains.csv'); const out=[];
    for(const d of domains){ const host=d.replace(/^www\./,'');
      PATHS.forEach(p=>out.push(`${host},https://${host}${p},`)); out.push(`${host},https://status.${host}/,Status`); out.push(`${host},https://status.${host}/api/v2/summary.json,Status`);
    }
    ensureFile('data/endpoints.csv', out.join('\n')+'\n');
  }
  if(!fs.existsSync('data/endpoints.csv')) throw new Error('endpoints.csv missing');
}

async function seed(){
  ensureDomainsAndEndpoints();
  const eps = lines('data/endpoints.csv').slice(0, MAX_ENDPOINTS)
              .map(l=>{ const [vendor,url,type] = l.split(','); return {vendor,url,type}; })
              .filter(r=>r && r.vendor && r.url && /^https?:\/\//.test(r.url));
  const vendorQuota = new Map();

  for(const r of eps){
    if(countToday() >= TARGET_TODAY) break;
    const used = vendorQuota.get(r.vendor)||0; if(used >= PER_VENDOR_MAX) continue;

    try{
      const u = new URL(r.url); const robots = await fetchRobots(u.hostname);
      if(!allowed(robots, u.pathname)) continue;

      // HEAD -> 条件信息；不行再 GET
      let head = await httpGet(r.url, {method:'HEAD'}).catch(()=>null);
      let etag = head?.res?.headers?.etag||'', last = head?.res?.headers?.['last-modified']||'';
      let bodyBuf = head?.body||Buffer.from('');
      if(!etag && !last){ const got = await httpGet(r.url, {method:'GET'}).catch(()=>null);
        if(got){ etag = got.res.headers.etag||etag; last = got.res.headers['last-modified']||last; bodyBuf = got.body||bodyBuf; }
      }
      // 没拿到正文也不强求（以头部特征为证据），但尽量取到
      const hash = sha256(bodyBuf);
      const dir = path.join('evidence', r.vendor); fs.mkdirSync(dir,{recursive:true});
      const tag = (r.type||'Baseline').replace(/\s+/g,'_');
      const fname = `${today()}-${tag}-${hash.slice(0,10)}.json`;

      if(vendorTodayCount(r.vendor) >= PER_VENDOR_MAX) continue;

      const obj = { vendor:r.vendor, type:(r.type||'Baseline'), url:r.url,
                    detected_at:new Date().toISOString(),
                    etag: etag||null, last_modified:last||null, hash: bodyBuf.length?`sha256:${hash}`:null };
      fs.writeFileSync(path.join(dir, fname), JSON.stringify(obj,null,2),'utf8');
      vendorQuota.set(r.vendor, used+1);
      console.log('[seed]', r.vendor, r.type||'Baseline', '→', fname);
    }catch(e){ /* 忽略错误继续 */ }
  }
  console.log(`[seed] today=${countToday()}/${TARGET_TODAY}`);
}

seed().catch(e=>{ console.error(e); process.exit(1); });
