#!/usr/bin/env node
const fs=require('fs'), path=require('path');

const domFile='data/domains.csv', outFile='data/endpoints.csv';
if(!fs.existsSync(domFile)) process.exit(0);

const normHost = s=>{
  s=String(s||'').trim().replace(/^"|"$/g,'');
  s=s.split(',')[0].trim();               // 逗号前
  s=s.replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'').toLowerCase();
  s=s.replace(/[^a-z0-9\.\-\_]/g,'');
  return s;
};
const badHost = h => /^(_seed|acme|example)\./i.test(h) || h==='example.com';

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

const domains = fs.readFileSync(domFile,'utf8').split(/\r?\n/).map(normHost).filter(Boolean).filter(h=>!badHost(h));
const set = new Map();
for(const host of domains){
  for(const [p,t] of PATHS) set.set(`https://${host}${p}`, t);
  set.set(`https://status.${host}/`, 'Status');
  set.set(`https://status.${host}/api/v2/summary.json`, 'Status');
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
