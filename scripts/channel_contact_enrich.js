#!/usr/bin/env node
// 从 data/channel_candidates.csv 抽取邮箱（公开页面/ mailto），验证 MX，拼出 partners 列表（限量）
const fs=require('fs'), path=require('path'), https=require('https'), http=require('http'), dns=require('dns').promises;

const UA="CGAlertBot/1.0 (+https://www.cg-alert.com/)";
const TIMEOUT_MS=12000;
const PROMOTE_LIMIT = Math.max(10, Number(process.env.CHANNEL_PROMOTE_LIMIT||10));

function httpRequest(u){
  return new Promise((resolve,reject)=>{
    const mod = u.startsWith('https:')?https:http;
    const req = mod.request(u, {method:'GET', timeout:TIMEOUT_MS, headers:{'user-agent':UA,'accept':'text/html,*/*'}}, res=>{
      const bufs=[]; res.on('data',d=>bufs.push(d)); res.on('end',()=>resolve({res, body:Buffer.concat(bufs)}));
    });
    req.on('timeout',()=>req.destroy(new Error('timeout'))); req.on('error',reject); req.end();
  });
}
function nameFromDomain(d){
  const s=d.replace(/^www\./,'').split('.')[0];
  return s.split('-').map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(' ');
}
async function hasMx(d){
  try{ const mx=await dns.resolveMx(d); return !!(mx && mx.length); }catch{ return false; }
}
function existingEmails(){
  const out=new Set();
  if(fs.existsSync('data/channel_partners.csv')){
    for(const l of fs.readFileSync('data/channel_partners.csv','utf8').split(/\r?\n/)){
      const s=l.trim(); if(!s) continue;
      out.add(s.split(',')[0].toLowerCase());
    }
  }
  return out;
}
function candidates(){
  if(!fs.existsSync('data/channel_candidates.csv')) return [];
  return fs.readFileSync('data/channel_candidates.csv','utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
    .map(l=>{ const [domain,srcVendor,srcUrl]=l.split(','); return {domain,srcVendor,srcUrl}; });
}
async function tryEmails(domain, htmlList){
  const found=new Set();
  const re=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
  for(const html of htmlList){ let m; while((m=re.exec(html))){ const e=m[0].toLowerCase(); if(e.endsWith('@'+domain)) found.add(e); if(found.size>=5) break; } }
  if(found.size) return Array.from(found);
  // fallback 组合
  return [`sales@${domain}`,`hello@${domain}`,`contact@${domain}`,`info@${domain}`];
}
async function fetchPages(domain){
  const pages=[`https://${domain}/contact`, `https://${domain}/contact-us`, `https://${domain}/about`, `https://${domain}/company`, `https://${domain}/services`, `https://${domain}/get-in-touch`];
  const out=[];
  for(const u of pages){
    try{
      const {res, body}=await httpRequest(u);
      const ct=(res.headers['content-type']||''); if((res.statusCode||0)<400 && ct.includes('text')) out.push(body.toString('utf8'));
    }catch{}
  }
  return out;
}

(async function main(){
  const exist = existingEmails();
  const cand = candidates();
  let promoted=0;

  for(const c of cand){
    if(promoted>=PROMOTE_LIMIT) break;
    const ok=await hasMx(c.domain); if(!ok) continue;
    const htmls=await fetchPages(c.domain);
    const emails=await tryEmails(c.domain, htmls);
    let picked=null;
    for(const e of emails){ if(!exist.has(e)){ picked=e; break; } }
    if(!picked) continue;

    const name=nameFromDomain(c.domain);
    const slug=c.domain;
    fs.appendFileSync('data/channel_partners.csv', `${picked},${name},${slug}\n`);
    exist.add(picked); promoted++;
    console.log('[channel-promote]', picked, '←', c.domain);
  }
  console.log(`[channel-promote] promoted=${promoted}`);
})();
