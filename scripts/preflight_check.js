// scripts/preflight_check.js
const fs = require('fs'); const path = require('path');
const mustFiles = [
  'scripts/build_updates.js', 'scripts/send_bulk.js', 'scripts/validate_leads.js', '.github/workflows/Outreach-S1.yml',
];
const niceToHave = [
  '.github/workflows/Outreach-S2.yml', '.github/workflows/discover-contacts.yml', '.github/workflows/leads-lint.yml',
  'scripts/follow_up.js', 'scripts/discover_contacts.js',
];
function checkExists(list, fatal=true){ let ok=true; for(const p of list){ if(!fs.existsSync(p)){ console[fatal?'error':'warn'](`Missing: ${p}`); ok=false; } else console.log(`OK: ${p}`); } if(fatal && !ok) process.exit(2); }
function scanEvidence(){ const base=path.join(process.cwd(),'evidence'); if(!fs.existsSync(base)){ console.warn('WARN: evidence/ not found'); return; }
  const vendors=fs.readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name); let parsed=0, failed=0;
  for(const v of vendors){ const vdir=path.join(base,v); const files=fs.readdirSync(vdir).filter(f=>f.endsWith('.json'));
    for(const f of files){ const fp=path.join(vdir,f); try{ const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) throw new Error('empty'); JSON.parse(raw); parsed++; }catch(e){ console.error(`Evidence JSON parse error: ${fp} :: ${e.message}`); failed++; } } }
  if (failed>0){ console.error(`Evidence check: ${parsed} ok, ${failed} failed`); process.exit(3); } else console.log(`Evidence check: ${parsed} ok, 0 failed`);
}
function checkLeadsHeader(){ const fp=path.join(process.cwd(),'data','leads.csv'); if(!fs.existsSync(fp)){ console.warn('WARN: data/leads.csv not found'); return; }
  const head=fs.readFileSync(fp,'utf8').split(/\r?\n/)[0].toLowerCase();
  const need=['email','company','domain']; const miss=need.filter(k=>!head.includes(k));
  if(miss.length){ console.error(`data/leads.csv header missing: ${miss.join(', ')}`); process.exit(4); } else console.log('leads.csv header OK');
}
(function main(){ console.log('== Preflight: required files =='); checkExists(mustFiles,true);
  console.log('== Preflight: optional files =='); checkExists(niceToHave,false);
  console.log('== Preflight: evidence JSON =='); scanEvidence();
  console.log('== Preflight: leads header =='); checkLeadsHeader();
  console.log('Preflight passed.'); })();
