// scripts/discover_contacts.js
// 读取 data/domains.csv → 仅对“有公开合规页”的域，生成公开角色邮箱 → 追加到 data/leads.csv
// 公开页判定：/pricing /legal /privacy /terms /dpa /subprocessors(/sub-processors) /status /trust

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FP_DOMAINS = path.join(ROOT, 'data', 'domains.csv');
const FP_LEADS   = path.join(ROOT, 'data', 'leads.csv');

const ROLES = ['security', 'privacy', 'legal', 'dpo', 'compliance', 'trust'];
const PATHS = ['/pricing','/legal','/privacy','/terms','/tos','/dpa','/subprocessors','/sub-processors','/status','/trust','/trust-center'];
const UA = 'CG-Alert-Discover/1.0 (+https://www.cg-alert.com)';

const SLEEP_BETWEEN_CHECKS_MS = 300;   // 每个 URL 之间停 0.3s
const SLEEP_BETWEEN_DOMAINS_MS = 600;  // 每个域之间停 0.6s
const HEAD_TIMEOUT_MS = 8000;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function readCsv(fp){
  if(!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp,'utf8').trim();
  if(!raw) return [];
  const [h, ...rows] = raw.split(/\r?\n/).filter(Boolean);
  const keys = h.split(',').map(s=>s.trim());
  return rows.map(line=>{
    const cells = line.split(',');
    const o = {};
    keys.forEach((k,i)=>o[k]=String(cells[i]??'').trim());
    return o;
  });
}

function writeCsv(fp, rows, header){
  const keys = header || Object.keys(rows[0] || {});
  const head = keys.join(',') + '\n';
  const body = rows.map(r=>keys.map(k=>r[k]??'').join(',')).join('\n');
  fs.mkdirSync(path.dirname(fp), {recursive:true});
  fs.writeFileSync(fp, head + (rows.length? body+'\n' : ''), 'utf8');
}

function appendLeads(rows){
  const header = ['email','company','domain','status','seq','last_touch'];
  if(!fs.existsSync(FP_LEADS)){ writeCsv(FP_LEADS, rows, header); return; }
  const existing = readCsv(FP_LEADS);
  const have = new Set(existing.map(r=>(r.email||'').toLowerCase()));
  const filtered = rows.filter(r=>!have.has((r.email||'').toLowerCase()));
  if(filtered.length===0) return;
  const lines = filtered.map(r=>header.map(k=>r[k]??'').join(',')).join('\n') + '\n';
  fs.appendFileSync(FP_LEADS, lines, 'utf8');
}

async function withTimeout(promise, ms){
  let t; const timeout = new Promise((_,rej)=> t=setTimeout(()=>rej(new Error('timeout')), ms));
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(t); }
}

async function urlOK(url){
  try{
    const res = await withTimeout(fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml'},
    }), HEAD_TIMEOUT_MS);
    if (res && res.ok) return true;
    // 有些源站对 HEAD 不友好，回退 GET 只取少量
    const res2 = await withTimeout(fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {'User-Agent': UA, 'Range': 'bytes=0-0', 'Accept': 'text/html'},
    }), HEAD_TIMEOUT_MS);
    return !!(res2 && res2.ok);
  }catch{
    return false;
  }
}

async function hasPublicPages(domain){
  const bases = [`https://${domain}`, `https://www.${domain}`];
  for(const base of bases){
    let hits = 0;
    for(const p of PATHS){
      const ok = await urlOK(base + p);
      if(ok){ hits++; break; }
      await sleep(SLEEP_BETWEEN_CHECKS_MS);
    }
    if(hits>0) return true;
  }
  return false;
}

(async function main(){
  const domains = readCsv(FP_DOMAINS)
    .map(r=>({domain: String(r.domain||'').toLowerCase().trim(), company: r.company||''}))
    .filter(r=>r.domain);

  if(domains.length===0){
    console.log('discover_contacts: no domains.csv'); return;
  }

  const leadsToAppend = [];
  const existing = fs.existsSync(FP_LEADS) ? readCsv(FP_LEADS) : [];
  const have = new Set(existing.map(r=>(r.email||'').toLowerCase()));

  for(const {domain, company} of domains){
    const ok = await hasPublicPages(domain);
    if(!ok){ await sleep(SLEEP_BETWEEN_DOMAINS_MS); continue; }

    for(const role of ROLES){
      const email = `${role}@${domain}`.toLowerCase();
      if(have.has(email)) continue;
      leadsToAppend.push({ email, company, domain, status: 'new', seq: '', last_touch: '' });
    }
    await sleep(SLEEP_BETWEEN_DOMAINS_MS);
  }

  if(leadsToAppend.length>0) appendLeads(leadsToAppend);
  console.log(`discover_contacts: added=${leadsToAppend.length}, leads_total=${(fs.existsSync(FP_LEADS)? readCsv(FP_LEADS).length : leadsToAppend.length)}`);
})();
