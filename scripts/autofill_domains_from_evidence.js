#!/usr/bin/env node
// autofill_domains_from_evidence.js — infer domains from evidence vendor slugs and add to data/domains.csv
const fs=require('fs'), path=require('path');
(function main(){
  const base='evidence', out='data/domains.csv'; const seen = new Set(fs.existsSync(out)?fs.readFileSync(out,'utf8').split(/\r?\n/).filter(Boolean):[]);
  if(!fs.existsSync(base)){ console.log('[autofill-domains] no evidence/'); return; }
  const add=[]; for(const d of fs.readdirSync(base,{withFileTypes:true})){ if(!d.isDirectory()) continue; const slug=d.name; const domain=slug.includes('.')?slug:`${slug}.com`; if(!seen.has(domain)){ seen.add(domain); add.push(domain);} }
  if(add.length){ fs.appendFileSync(out, add.join('\n')+'\n','utf8'); console.log(`[autofill-domains] appended ${add.length}`);} else { console.log('[autofill-domains] none'); }
})();