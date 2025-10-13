#!/usr/bin/env node
// endpoint_inventory.js — 基于 domains.csv 生成标准 endpoints.csv（三列：host,url,type）
const fs=require('fs'), path=require('path');

const domFile='data/domains.csv', outFile='data/endpoints.csv';
if(!fs.existsSync(domFile)) process.exit(0);

const normHost = s=>{
  s=String(s||'').trim().replace(/^"|"$/g,'');
  s=s.split(/[\s,]+/)[0].trim();
  s=s.replace(/^https?:\/\//,'').replace(/\/.*/,'').replace(/^www\./,'').toLowerCase();
  s=s.replace(/[^a-z0-9._-]/g,'');
  return s;
};
const badHost = h => /^(_seed|acme|example)\./i.test(h) || h==='example.com';

const PATHS = [
  ['/pricing','Pricing'],['/plans','Pricing'],
  ['/terms','ToS'],['/tos','ToS'],['/legal/terms','ToS'],['/terms-of-service','ToS'],
  ['/privacy','Privacy'],['/privacy-policy','Privacy'],['/legal/privacy','Privacy'],
  ['/legal/dpa','DPA'],['/dpa','DPA'],['/data-processing-addendum','DPA'],
  ['/subprocessors','Subprocessors'],['/sub-processors','Subprocessors'],['/legal/subprocessors','Subprocessors'],
  ['/security','Security'],['/trust','Security'],['/trust-center','Security'],
  ['/status','Status'],['/status/','Status'],['/api/v2/summary.json','Status']
];

const txt = fs.readFileSync(domFile,'utf8');
const domains = txt.split(/\r?\n/).map(normHost).filter(Boolean).filter(h=>!badHost(h));
const set = new Set();
for(const host of domains){
  for(const [p,type] of PATHS){
    const url = (p.endsWith('.json')?`https://status.${host}${p}`:`https://${host}${p}`);
    try{ new URL(url); set.add(`${url},${type}`);}catch{}
  }
}

let existing=[];
if(fs.existsSync(outFile)){
  existing = fs.readFileSync(outFile,'utf8').split(/\r?\n/).filter(Boolean).filter(l=> (l.match(/,/g)||[]).length >= 2);
}

const lines = [...set.entries()].map(([url,type])=>{
  const host = new URL(url).hostname.replace(/^www\./,'').toLowerCase();
  return `${host},${url},${type}`;
});

const merged = new Set([ ...existing, ...lines ]);
fs.mkdirSync('data',{recursive:true});
fs.writeFileSync(outFile, [...merged].join('\n')+'\n','utf8');
console.log(`[inventory] endpoints=${merged.size}, domains=${domains.length}`);
