#!/usr/bin/env node
// 从 data/domains.csv 生成 data/endpoints.csv（幂等）；以 URL 为准，避免 vendor 里逗号干扰
const fs=require('fs'), path=require('path');

const domFile='data/domains.csv', outFile='data/endpoints.csv';
if(!fs.existsSync(domFile)) process.exit(0);

const normHost = h => h.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/+$/,'').toLowerCase();
const badHost = h => /^(_seed|acme|example)\./i.test(h) || /(^|\.)(example\.com)$/.test(h);

const PATHS = [
  ['/pricing','Pricing'],['/plans','Pricing'],
  ['/terms','ToS'],['/tos','ToS'],['/legal/terms','ToS'],['/terms-of-service','ToS'],
  ['/privacy','Privacy'],['/privacy-policy','Privacy'],['/legal/privacy','Privacy'],
  ['/legal/dpa','DPA'],['/dpa','DPA'],['/data-processing-addendum','DPA'],
  ['/subprocessors','Subprocessors'],['/sub-processors','Subprocessors'],['/legal/subprocessors','Subprocessors'],
  ['/security','Security'],['/trust','Security'],['/trust-center','Security'],['/legal/security','Security'],
  ['/.well-known/security.txt','Security'],
  ['/status','Status']
];

const domains = fs.readFileSync(domFile,'utf8').split(/\r?\n/).map(s=>normHost(s.trim())).filter(Boolean);
const set = new Map();
for(const host of domains){
  if(badHost(host)) continue;
  for(const [p,t] of PATHS) set.set(`https://${host}${p}`, t);
  set.set(`https://status.${host}/`, 'Status');
  set.set(`https://status.${host}/api/v2/summary.json`, 'Status');
}

let existing=[];
if(fs.existsSync(outFile)){
  existing = fs.readFileSync(outFile,'utf8').split(/\r?\n/).filter(Boolean);
}

const lines = [...set.entries()].map(([url,type])=>{
  const host = new URL(url).hostname.replace(/^www\./,'').toLowerCase();
  return `${host},${url},${type}`;
});

const merged = new Set([ ...existing, ...lines ]);
fs.mkdirSync('data',{recursive:true});
fs.writeFileSync(outFile, [...merged].join('\n')+'\n','utf8');
console.log(`[inventory] endpoints=${merged.size}, domains=${domains.length}`);
