// scripts/validate_leads.js
const fs = require('fs');
const dns = require('dns').promises;
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const leadsPath = path.join(__dirname, '..', 'data', 'leads.csv');

function normEmail(s){ return (s||'').trim().toLowerCase(); }
function looksLikeEmail(e){ return /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(e); }
function domainOf(e){ return (e.split('@')[1]||'').toLowerCase(); }
async function hasMX(domain){ try{ const mx=await dns.resolveMx(domain); return Array.isArray(mx)&&mx.length>0; }catch{ return false; } }

(async ()=>{
  if (!fs.existsSync(leadsPath)) { console.warn('leads.csv not found'); process.exit(0); }
  const rows = parse(fs.readFileSync(leadsPath,'utf8'), { columns:true, skip_empty_lines:true });

  const seen = new Set(), out = []; let changed=false;
  for (const r of rows){
    r.email = normEmail(r.email); r.persona = r.persona||''; r.status=r.status||'';
    const k = r.email ? `e:${r.email}` : `d:${(r.domain||'').toLowerCase()}#${(r.persona||'').toLowerCase()}`;
    if (seen.has(k)) { changed=true; continue; }
    seen.add(k); out.push(r);
  }
  for (const r of out){
    if (r.email){
      if (!looksLikeEmail(r.email)){ r.status='invalid'; r.mx_ok=false; changed=true; continue; }
      const mxok = await hasMX(domainOf(r.email));
      if (String(r.mx_ok)!==String(mxok)){ r.mx_ok=mxok; changed=true; }
      if (!mxok) r.status='invalid';
    } else {
      if (!r.mx_ok) r.mx_ok='';
    }
  }
  if (changed) fs.writeFileSync(leadsPath, stringify(out,{header:true}),'utf8');
  console.log(`validate_leads: ${out.length} rows${changed?' (updated)':''}`);
})();
