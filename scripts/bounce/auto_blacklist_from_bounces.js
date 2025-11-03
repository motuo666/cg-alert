#!/usr/bin/env node
const fs=require('fs'), path=require('path'), cp=require('child_process');
function walk(d){ const out=[]; if(!fs.existsSync(d)) return out; for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) out.push(...walk(p)); else out.push(p);} return out; }
function lines(p){ try{ return fs.readFileSync(p,'utf8').split(/\r?\n/);}catch{ return []; } }
function uniq(a){ return Array.from(new Set(a)); }
const candidates = walk('artifacts').concat(walk('reports'));
const emails=[];
for(const f of candidates){
  const txt = lines(f).join('\n');
  for(const m of txt.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/ig)){ emails.push(m[0]); }
}
const domains = uniq(emails.map(e=>e.split('@')[1].toLowerCase())).filter(Boolean);
const dst = path.join('config','blacklist','domains_auto.txt');
let exist=[]; try{ exist = fs.readFileSync(dst,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}catch{}
const merged = uniq(exist.concat(domains)).sort();
if(merged.join('\n') !== exist.join('\n')){
  fs.mkdirSync(path.dirname(dst),{recursive:true});
  fs.writeFileSync(dst, merged.join('\n')+'\n');
  cp.execSync('git add '+dst);
  try{ cp.execSync('git -c user.email=bot@cg-alert.com -c user.name=cg-alert-bot commit -m "blacklist: auto domains from bounces"'); cp.execSync('git push'); }catch{}
  const repo = process.env.GITHUB_REPOSITORY || ''; const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  if(repo && token){
    const curl = `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" https://api.github.com/repos/${repo}/dispatches -d '{"event_type":"kv_sync_kick"}'`;
    try{ cp.execSync(curl, {stdio:'inherit'}); }catch(e){ console.log('dispatch failed', e.message); }
  }
  console.log('auto blacklist updated', merged.length);
}else{ console.log('no new domains from bounces'); }
