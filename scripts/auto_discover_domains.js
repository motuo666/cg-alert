#!/usr/bin/env node
const fs=require('fs'), path=require('path');

const domFile='data/domains.csv';
const LIMIT = Number(process.env.NEW_DOMAINS_LIMIT||50);

const TLD = '(com|io|ai|co|app|dev|cloud|net|org|tech|so|us|uk|de|xyz|co\\.uk|io\\.uk)';
const HOST_RE = new RegExp(`\\b([a-z0-9-]+\\.)+${TLD}\\b`, 'ig');

const BAD = new Set([
  'example.com','localhost','cg-alert.com','statuspage.io','google.com','facebook.com','twitter.com','linkedin.com',
  'doubleclick.net','googletagmanager.com','gstatic.com','google-analytics.com','cloudfront.net','cdn.cloudflare.net'
]);

function loadDomains(){
  if(!fs.existsSync(domFile)) return new Set();
  return new Set(fs.readFileSync(domFile,'utf8').split(/\r?\n/).map(s=>s.trim().toLowerCase()).filter(Boolean));
}
function* walk(dir, ext){
  if(!fs.existsSync(dir)) return;
  for(const d of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,d.name);
    if(d.isDirectory()) yield* walk(p, ext);
    else if(p.endsWith(ext)) yield p;
  }
}
function norm(h){
  return h.replace(/^www\./,'').toLowerCase();
}
function accept(h){
  if(!h) return false;
  if(BAD.has(h)) return false;
  if(/^(_seed|acme|example)\./.test(h)) return false;
  if(h.endsWith('.example.com')) return false;
  // 只收看起来像供应商主域的（简单启发）
  if(h.split('.').length < 2) return false;
  return true;
}

(function main(){
  const have = loadDomains();
  const cand = new Set();

  // 从 evidence url 抽
  for(const f of walk('evidence','.json')){
    try{
      const j=JSON.parse(fs.readFileSync(f,'utf8'));
      if(j?.url){
        const u = new URL(j.url);
        cand.add(norm(u.hostname));
      }
    }catch(e){}
  }
  // 从缓存正文抽（需要 Poller 设置 SAVE_BODY=1 跑过一轮）
  for(const f of walk('.cache/http','.body.txt')){
    const txt = fs.readFileSync(f,'utf8');
    let m; while((m = HOST_RE.exec(txt))){ cand.add(norm(m[0])); if(cand.size>5000) break; }
  }

  // 过滤已有/黑名单，仅取前 LIMIT 个
  const add = [];
  for(const h of cand){
    if(add.length>=LIMIT) break;
    if(!accept(h)) continue;
    if(have.has(h)) continue;
    add.push(h);
  }

  if(!add.length){ console.log('[discover] no new domains'); process.exit(0); }
  fs.mkdirSync('data',{recursive:true});
  fs.appendFileSync(domFile, add.join('\n')+'\n','utf8');
  console.log(`[discover] appended ${add.length} domains`);
})();
