#!/usr/bin/env node
// endpoint_inventory.js — 从 domains.csv 生成端点候选 (幂等)
const fs=require('fs'), path=require('path');
const domFile='data/domains.csv', outFile='data/endpoints.csv';
if(!fs.existsSync(domFile)) process.exit(0);
const domains=fs.readFileSync(domFile,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);

const PATHS = [
  {p:'/pricing', t:'Pricing'}, {p:'/plans', t:'Pricing'},
  {p:'/terms', t:'ToS'}, {p:'/tos', t:'ToS'}, {p:'/legal/terms', t:'ToS'},
  {p:'/privacy', t:'Privacy'}, {p:'/privacy-policy', t:'Privacy'}, {p:'/legal/privacy', t:'Privacy'},
  {p:'/dpa', t:'DPA'}, {p:'/legal/dpa', t:'DPA'}, {p:'/data-processing-addendum', t:'DPA'},
  {p:'/subprocessors', t:'Subprocessors'}, {p:'/sub-processors', t:'Subprocessors'}, {p:'/legal/subprocessors', t:'Subprocessors'},
  {p:'/.well-known/security.txt', t:'Security'},
  {p:'/status', t:'Status'}
];

function makeURLs(domain){
  const base = domain.replace(/^https?:\/\//,'').replace(/\/+$/,'').toLowerCase();
  const host = base.replace(/^www\./,'');
  const set = new Map();
  for(const {p,t} of PATHS){
    set.set(`https://${host}${p}`, t);
  }
  // status.<domain>
  set.set(`https://status.${host}/`, 'Status');
  return [...set.entries()].map(([url,type])=>({vendor:host,url,type}));
}

const merged = [];
for(const d of domains){ merged.push(...makeURLs(d)); }

// 去重并与 existing 合并（优先保留旧行）
let existing = [];
if(fs.existsSync(outFile)){
  existing = fs.readFileSync(outFile,'utf8').split(/\r?\n/).filter(Boolean).map(l=>{
    const [vendor,url,type]=l.split(','); return {vendor,url,type};
  });
}
const key = r => `${r.vendor}|${r.url}`;
const seen = new Set(existing.map(key));
for(const r of merged){ if(!seen.has(key(r))) { existing.push(r); seen.add(key(r)); } }

const lines = existing.map(r=>`${r.vendor},${r.url},${r.type||''}`).join('\n')+'\n';
fs.mkdirSync('data',{recursive:true});
fs.writeFileSync(outFile, lines, 'utf8');
console.log(`[inventory] endpoints=${existing.length}`);
