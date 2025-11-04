// scripts/customers_sync.js
/**
 * Merge intakes.csv -> customers.csv (idempotent).
 * Expected headers (case-insensitive): email, company, tier/plan, cadence, vendors
 * Defaults: tier=portfolio, cadence=weekly, vendors=''
 */
const fs = require('fs');
function readCSV(p){
  if(!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n').trim();
  if(!raw) return null;
  const [head, ...rows] = raw.split('\n').filter(Boolean);
  const cols = head.split(',').map(s=>s.trim().toLowerCase());
  return rows.map(r=>{
    const vals=r.split(','); const o={};
    cols.forEach((c,i)=> o[c]= (vals[i]||'').trim());
    return o;
  });
}

function readCSV_multi(paths){
  const seen = new Set();
  let all = [];
  for (const p of paths){
    const rows = readCSV(p) || [];
    for (const r of rows){
      const key = (r.email||'')+'|'+(r.company||'')+'|'+(r.vendors||'')+'|'+(r.plan||r.tier||'')+'|'+(r.cadence||'');
      if (!seen.has(key)){ seen.add(key); all.push(r); }
    }
  }
  return all;
}
function writeCSV(p, rows){
  const cols = ['email','company','tier','cadence','vendors'];
  const lines = [cols.join(',')].concat(rows.map(r=>cols.map(c=> (r[c]||'')).join(',')));
  fs.writeFileSync(p, lines.join('\n')+'\n');
}
function normalizeTier(s){
  s = (s||'').toLowerCase();
  if(/business/.test(s)) return 'business';
  if(/enterprise|ent/.test(s)) return 'enterprise';
  return 'portfolio';
}
function normalizeCadence(s){
  s = (s||'').toLowerCase();
  if(/daily|day/.test(s)) return 'daily';
  return 'weekly';
}
function normalizeVendors(s){
  if(!s) return '';
  return s.replace(/[; ]+/g,',').replace(/,+/g,',').replace(/^,|,$/g,'');
}

(function main(){
  const inputs = ['intakes.csv','data/intakes.csv'];
  const dst = 'customers.csv';
  let src = [];
  for (const p of inputs){ const rows = readCSV(p); if(rows) src = src.concat(rows); }
  if(!src.length){ console.log('no intakes (root or data/), skip'); return; }
  let dstRows = [];
  if(fs.existsSync(dst)){
    const d = readCSV(dst);
    if(d) dstRows = d.map(r=>({email:r.email||'', company:r.company||'', tier:r.tier||'portfolio', cadence:r.cadence||'weekly', vendors:r.vendors||''}));
  }
  const seen = new Map(dstRows.map(r=>[r.email.toLowerCase(), r]));

  let added=0, updated=0;
  for(const r of src){
    const email=(r.email||r.mail||'').toLowerCase();
    if(!email || !/@/.test(email)) continue;
    const item = {
      email,
      company: r.company||r.org||'',
      tier: normalizeTier(r.tier||r.plan||''),
      cadence: normalizeCadence(r.cadence||''),
      vendors: normalizeVendors(r.vendors||r.vendor||'')
    };
    if(seen.has(email)){
      const old = seen.get(email);
      const merged = {...old, ...Object.fromEntries(Object.entries(item).filter(([k,v])=>v!==''))};
      seen.set(email, merged); updated++;
    } else {
      seen.set(email, item); added++;
    }
  }
  const out = Array.from(seen.values());
  writeCSV(dst, out);
  console.log(`customers_sync done. added=${added} updated=${updated} total=${out.length}`);
})();