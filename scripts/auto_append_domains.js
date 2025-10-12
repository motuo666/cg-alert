#!/usr/bin/env node
// auto_append_domains.js — append missing domains from vendors/* into data/domains.csv
const fs=require('fs'), path=require('path');
(function main(){
  const base='vendors'; const target='data/domains.csv'; const seen = new Set(fs.existsSync(target)?fs.readFileSync(target,'utf8').split(/\r?\n/).filter(Boolean):[]);
  if(!fs.existsSync(base)){ console.log('[auto-domains] no vendors/'); return; }
  const add=[]; for(const d of fs.readdirSync(base,{withFileTypes:true})){ if(!d.isDirectory()) continue; const v=d.name; const domain=v.includes('.')? v : `${v}.com`; if(!seen.has(domain)){ add.push(domain); seen.add(domain);} }
  if(add.length){ fs.appendFileSync(target, add.join('\n')+'\n','utf8'); console.log(`[auto-domains] appended ${add.length}`);} else { console.log('[auto-domains] none'); }
})();