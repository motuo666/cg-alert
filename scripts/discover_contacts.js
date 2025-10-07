// scripts/discover_contacts.js
// 依赖：csv-parse, csv-stringify（工作流里按包名安装即可）
const fs = require('fs'); const path = require('path');
const { parse } = require('csv-parse/sync'); const { stringify } = require('csv-stringify/sync');

const UA = 'CGAlertBot/1.0 (+https://www.cg-alert.com; respect robots.txt)';
const SLOW_MIN = 3000, SLOW_MAX = 5000;
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function jitter(){ return Math.floor(Math.random()*(SLOW_MAX-SLOW_MIN+1))+SLOW_MIN; }
function ensureHttps(u){ return u.startsWith('http') ? u : `https://${u}`; }

const ROLE_PREFIXES = ['security','privacy','legal','compliance','procurement','sourcing','it','dpo','trust','gdpr'];
const CANDIDATE_PATHS = ['/.well-known/security.txt','/security.txt','/privacy','/legal','/contact','/trust','/security'];
function looksRole(email){ const [local] = email.split('@'); const l=(local||'').toLowerCase(); return ROLE_PREFIXES.some(p=>l.startsWith(p)); }
function sameDomain(email, target){ const d=(email.split('@')[1]||'').toLowerCase(); return d===target.toLowerCase(); }

async function fetchText(url){
  try{
    const res = await fetch(url, { headers:{ 'User-Agent': UA, 'Accept':'text/html, text/plain', 'Accept-Language':'en' } });
    if (!res.ok) return null; const ct=res.headers.get('content-type')||''; if (!(ct.includes('text')||ct.includes('html'))) return null;
    return await res.text();
  }catch{ return null; }
}
function extractEmails(text){
  if (!text) return []; const out=new Set();
  const re1=/mailto:([^"'<>\s)]+)/ig; let m; while((m=re1.exec(text))!==null){ out.add((m[1]||'').replace(/\?.*$/,'').trim().toLowerCase()); }
  const re2=/\b([a-z0-9._%+\-]+@[a-z0-9.-]+\.[a-z]{2,})\b/ig; while((m=re2.exec(text))!==null){ out.add((m[1]||'').toLowerCase()); }
  return [...out];
}
async function probeDomain(domain){
  const hits=new Set(); const bases=[`https://${domain}`,`https://www.${domain}`,`https://security.${domain}`,`https://trust.${domain}`];
  for (const base of bases){
    for (const p of CANDIDATE_PATHS){
      const body = await fetchText(ensureHttps(base+p));
      if (body){ extractEmails(body).forEach(e=>{ if (looksRole(e)&&sameDomain(e,domain)) hits.add(e); }); }
      await sleep(jitter());
    }
  }
  return [...hits];
}
function readCsv(fp){ if(!fs.existsSync(fp)) return []; const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return []; return parse(raw,{columns:true, skip_empty_lines:true}); }
function writeCsv(fp, rows){ const csv=stringify(rows,{header:true}); fs.writeFileSync(fp,csv,'utf8'); }

(async ()=>{
  const domainsPath=path.join(__dirname,'..','data','domains.csv');
  const leadsPath=path.join(__dirname,'..','data','leads.csv');
  const domains=readCsv(domainsPath); if(domains.length===0){ console.log('no domains.csv'); process.exit(0); }
  const leads=readCsv(leadsPath); const seenEmail=new Set(leads.map(r=>(r.email||'').toLowerCase()).filter(Boolean));
  let added=0;
  for (const d of domains){
    const domain=(d.domain||'').toLowerCase().trim(); const company=d.company||''; if(!domain) continue;
    const found=await probeDomain(domain);
    for (const email of found){
      if (seenEmail.has(email)) continue; seenEmail.add(email);
      const persona = email.startsWith('security@')||email.startsWith('trust@')?'Security'
        : (email.startsWith('privacy@')||email.startsWith('gdpr@')||email.startsWith('dpo@')||email.startsWith('legal@')||email.startsWith('compliance@'))?'Legal'
        : (email.startsWith('procurement@')||email.startsWith('sourcing@'))?'Procurement'
        : email.startsWith('it@')?'IT':'General';
      leads.push({ email, company: company||domain, domain, vendor1:'', vendor2:'', vendor3:'', persona, status:'', notes:'auto:security/privacy/legal/trust', sent_at:'' });
      added++;
    }
  }
  if (added>0){ writeCsv(leadsPath, leads); console.log(`discover_contacts: added ${added} leads`); }
  else console.log('discover_contacts: no new leads');
})();
