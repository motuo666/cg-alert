#!/usr/bin/env node
// validate_leads.js — strict 9 columns; dedupe; sanitize; exit 1 on error
const fs=require('fs'), path=require('path');
const FILE=path.join('data','leads.csv');
const ENUM=new Set(['new','sent','bounced','unsub','optout','invalid','bad-mx']);
function trim(s){ return String(s ?? '').trim(); }
function lower(s){ return trim(s).toLowerCase(); }
function validEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function domainFromEmail(e){ const m=String(e).split('@'); return m[1]||''; }
function parseLine(l){ const a=l.split(','); if(a.length<9) throw new Error('Each row must have 9 columns'); return a.map(x=>trim(x)); }
function readRows(){ if(!fs.existsSync(FILE)) return []; const lines=fs.readFileSync(FILE,'utf8').split(/\r?\n/).filter(Boolean); return lines.map(parseLine); }
function normalize(rows){
  const out=[]; const seen=new Set();
  for(let r of rows){
    r = r.slice(0,9); // force 9 columns
    let [email,company,domain,v1,v2,v3,persona,status,mx_ok] = r;
    email=lower(email); company=trim(company); domain=lower(domain||domainFromEmail(email));
    v1=trim(v1); v2=trim(v2); v3=trim(v3); persona=trim(persona||''); status=lower(status||'new'); mx_ok=mx_ok===''? '1' : (['0','1'].includes(trim(mx_ok))? trim(mx_ok) : '1');
    if(!validEmail(email)) throw new Error(`Invalid email: ${email}`);
    if(!ENUM.has(status)) throw new Error(`Invalid status: ${status}`);
    const key=email; if(seen.has(key)) continue; seen.add(key);
    out.push([email,company,domain,v1,v2,v3,persona,status,mx_ok]);
  }
  return out;
}
function writeRows(rows){ fs.writeFileSync(FILE, rows.map(r=>r.map(x=>/[",\n]/.test(x)?`"${x.replace(/"/g,'""')}"`:x).join(',')).join('\n')+'\n','utf8'); }
(function main(){ const rows=normalize(readRows()); writeRows(rows); console.log(`[leads] normalized ${rows.length} rows`); })();