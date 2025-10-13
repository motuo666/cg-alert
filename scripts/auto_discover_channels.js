#!/usr/bin/env node
// 从现有 vendors 的公开页面（/partners /resellers /alliance 等）抽潜在渠道域，写 data/channel_candidates.csv
const fs=require('fs'), path=require('path'), https=require('https'), http=require('http');

const UA="CGAlertBot/1.0 (+https://www.cg-alert.com/)";
const TIMEOUT_MS=12000;
const ADD_LIMIT = Math.max(20, Number(process.env.NEW_CHANNELS_LIMIT||20));

const PATHS = [
  '/partners','/partner','/resellers','/reseller','/alliances','/alliance',
  '/ecosystem','/solutions-partners','/solution-partners','/partner-directory','/partners/directory'
];

const BAD_HOST = new Set([
  'example.com','cg-alert.com','twitter.com','linkedin.com','facebook.com',
  'youtube.com','t.co','goo.gl','bit.ly','medium.com','developer.mozilla.org'
]);

function readDomains(){
  const f='data/domains.csv';
  if(!fs.existsSync(f)) return [];
  return fs.readFileSync(f,'utf8').split(/\r?\n/).map(s=>s.trim().toLowerCase()).filter(Boolean);
}
function httpRequest(u){
  return new Promise((resolve,reject)=>{
    const mod = u.startsWith('https:')?https:http;
    const req = mod.request(u, {method:'GET', timeout:TIMEOUT_MS, headers:{'user-agent':UA,'accept':'text/html,*/*'}}, res=>{
      const bufs=[]; res.on('data',d=>bufs.push(d)); res.on('end',()=>resolve({res, body:Buffer.concat(bufs)}));
    });
    req.on('timeout',()=>req.destroy(new Error('timeout'))); req.on('error',reject); req.end();
  });
}
async function robotsAllowed(host, pathname){
  const cache=`.cache/robots/${host}.txt`; fs.mkdirSync(path.dirname(cache),{recursive:true});
  if(fs.existsSync(cache) && (Date.now()-fs.statSync(cache).mtimeMs)<24*3600e3){
    return allow(fs.readFileSync(cache,'utf8'), pathname);
  }
  try{
    const {res, body} = await httpRequest(`https://${host}/robots.txt`);
    if(res.statusCode>=200 && res.statusCode<300) fs.writeFileSync(cache, body);
    else fs.writeFileSync(cache,'');
  }catch{ fs.writeFileSync(cache,''); }
  return allow(fs.readFileSync(cache,'utf8'), pathname);
}
function allow(robots, pathname){
  const rows=robots.split(/\r?\n/); let ua='*', dis=[];
  for(const l of rows){
    const s=l.trim(); if(!s||s.startsWith('#')) continue;
    const m1=s.match(/^User-agent:\s*(.+)$/i); if(m1){ ua=m1[1].toLowerCase(); continue; }
    const m2=s.match(/^Disallow:\s*(.*)$/i); if(m2 && (ua==='*'||ua==='cgalertbot')) dis.push(m2[1]);
  }
  return !dis.some(p=>p && pathname.startsWith(p));
}
function hostsFromHtml(html){
  const out=new Set();
  const re=/(https?:)?\/\/([a-z0-9.-]+\.[a-z.]{2,})(\/[^\s"'<>)]*)?/ig;
  let m; while((m=re.exec(html))){
    let h=(m[2]||'').toLowerCase().replace(/^www\./,'');
    if(!h || BAD_HOST.has(h)) continue;
    out.add(h);
    if(out.size>2000) break;
  }
  return out;
}
function loadCandidates(){
  const f='data/channel_candidates.csv';
  const have=new Set();
  if(fs.existsSync(f)){
    for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){
      const s=l.trim(); if(!s) continue;
      have.add(s.split(',')[0].toLowerCase());
    }
  }
  // 也排除已在 partners 列表里的
  if(fs.existsSync('data/channel_partners.csv')){
    for(const l of fs.readFileSync('data/channel_partners.csv','utf8').split(/\r?\n/)){
      const s=l.trim(); if(!s) continue;
      const d=s.split(',')[2] || s.split(',')[0]; // slug 或 email 里的域
      if(d) have.add(d.toLowerCase());
    }
  }
  return have;
}

(async function main(){
  const vendors=readDomains();
  const have=loadCandidates();
  let added=0;

  for(const v of vendors){
    if(added>=ADD_LIMIT) break;
    for(const p of PATHS){
      const url=`https://${v}${p}`;
      try{
        const u=new URL(url);
        if(!(await robotsAllowed(u.hostname,u.pathname))) continue;
        const {res, body} = await httpRequest(url);
        if((res.statusCode||0)>=200 && res.statusCode<400 && (res.headers['content-type']||'').includes('text')){
          const hs=hostsFromHtml(body.toString('utf8'));
          for(const h of hs){
            if(h===v || have.has(h)) continue;
            // 排除明显大站/社媒/资源域
            if(BAD_HOST.has(h) || /\.cdn$/.test(h) || /\.cloudfront\.net$/.test(h)) continue;
            fs.appendFileSync('data/channel_candidates.csv', `${h},${v},${url}\n`);
            have.add(h); added++;
            if(added>=ADD_LIMIT) break;
          }
        }
      }catch(e){ /* 忽略错误，继续 */ }
      if(added>=ADD_LIMIT) break;
    }
  }
  console.log(`[channel-discover] added=${added}`);
})();
