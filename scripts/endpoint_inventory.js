#!/usr/bin/env node
// endpoint_inventory.js — 从 data/domains.csv 生成端点候选 (幂等、覆盖更多高频变更页)
const fs=require('fs'), path=require('path');
const domFile='data/domains.csv', outFile='data/endpoints.csv';
if(!fs.existsSync(domFile)) process.exit(0);
const norm = s => s.replace(/^https?:\/\//,'').replace(/\/+$/,'').toLowerCase();
const domains=fs.readFileSync(domFile,'utf8').split(/\r?\n/).map(s=>norm(s.trim())).filter(Boolean);

const PATHS = [
  // Pricing / Plans
  {p:'/pricing', t:'Pricing'}, {p:'/plans', t:'Pricing'},
  // Terms / Legal
  {p:'/terms', t:'ToS'}, {p:'/tos', t:'ToS'}, {p:'/legal/terms', t:'ToS'},
  {p:'/terms-of-service', t:'ToS'}, {p:'/master-subscription-agreement', t:'ToS'},
  // Privacy / DPA
  {p:'/privacy', t:'Privacy'}, {p:'/privacy-policy', t:'Privacy'}, {p:'/legal/privacy', t:'Privacy'},
  {p:'/legal/dpa', t:'DPA'}, {p:'/dpa', t:'DPA'}, {p:'/data-processing-addendum', t:'DPA'},
  // Subprocessors
  {p:'/subprocessors', t:'Subprocessors'}, {p:'/sub-processors', t:'Subprocessors'}, {p:'/legal/subprocessors', t:'Subprocessors'},
  // Security / Trust
  {p:'/security', t:'Security'}, {p:'/trust', t:'Security'}, {p:'/trust-center', t:'Security'}, {p:'/legal/security', t:'Security'},
  // Well-known
  {p:'/.well-known/security.txt', t:'Security'},
  // Status
  {p:'/status', t:'Status'},
];

function makeURLs(domain){
  const host = domain.replace(/^www\./,'');
  const set = new Map();
  for(const {p,t} of PATHS) set.set(`https://${host}${p}`, t);
  // status.<domain> + status API（statuspage常见）
  set.set(`https://status.${host}/`, 'Status');
  set.set(`https://status.${host}/api/v2/summary.json`, 'Status');
  return [...set.entries()].map(([url,type])=>({vendor:host,url,type}));
}

let merged = [];
for(const d of domains){ merged.push(...makeURLs(d)); }

// 幂等合并
let existing = [];
if(fs.existsSync(outFile)){
  existing = fs.readFileSync(outFile,'utf8').split(/\r?\n/).filter(Boolean)
    .map(l=>{ const [vendor,url,type]=l.split(','); return {vendor,url,type}; });
}
const key = r => `${r.vendor}|${r.url}`;
const seen = new Set(existing.map(key));
for(const r of merged){ if(!seen.has(key(r))) { existing.push(r); seen.add(key(r)); } }

const lines = existing.map(r=>`${r.vendor},${r.url},${r.type||''}`).join('\n')+'\n';
fs.mkdirSync('data',{recursive:true});
fs.writeFileSync(outFile, lines, 'utf8');
console.log(`[inventory] endpoints=${existing.length}, domains=${domains.length}`);
