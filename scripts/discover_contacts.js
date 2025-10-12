#!/usr/bin/env node
// discover_contacts.js — derive cold emails from data/domains.csv into data/leads.csv (no external lookups)
const fs=require('fs'), path=require('path');
const FILE_DOMAINS=path.join('data','domains.csv'); const FILE_LEADS=path.join('data','leads.csv');
const PERSONAS=['security','compliance','privacy','legal','cto','ciso'];
function mkEmail(domain){ return [`security@${domain}`,`compliance@${domain}`,`privacy@${domain}`,`legal@${domain}`,`cto@${domain}`,`ciso@${domain}`,`info@${domain}`]; }
function valid(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
(function main(){
  if(!fs.existsSync(FILE_DOMAINS)){ console.log('[discover] no domains.csv'); return; }
  const domains = fs.readFileSync(FILE_DOMAINS,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out = []; for(const d of domains){ for(const e of mkEmail(d)){ if(valid(e)) out.push([e, d.split('.')[0], d, '', '', '', 'security', 'new', '1']); } }
  if(!out.length){ console.log('[discover] nothing to add'); return; }
  const lines = out.map(r=>r.join(',')).join('\n')+'\n'; fs.appendFileSync(FILE_LEADS, lines, 'utf8'); console.log(`[discover] appended ${out.length} leads`);
})();