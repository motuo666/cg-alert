// Promote new intakes -> customers.csv (dedupe by email+domain)
const fs = require('fs');

function parseCSV(txt){
  const [header, ...rows] = txt.trim().split(/\r?\n/);
  const cols = header.split(',');
  return {
    header: cols,
    rows: rows.filter(Boolean).map(line=>{
      const out=[]; let cur='',q=false;
      for(let i=0;i<line.length;i++){
        const ch=line[i];
        if(ch==='"' ){ if(q && line[i+1]==='"'){cur+='"'; i++;} else q=!q; }
        else if(ch===',' && !q){ out.push(cur); cur='';}
        else cur+=ch;
      }
      out.push(cur);
      const obj={}; cols.forEach((c,idx)=>obj[c]=out[idx]||'');
      return obj;
    })
  };
}

function ensureHeader(file, header){
  if(!fs.existsSync(file)) fs.writeFileSync(file, header.join(',')+'\n');
}

function appendCSV(file, objs, header){
  const lines = objs.map(o => header.map(h=>{
    const v = (o[h]||'').replace(/"/g,'""');
    return /[",\n]/.test(v) ? `"${v}"` : v;
  }).join(',')).join('\n') + '\n';
  fs.appendFileSync(file, lines);
}

(function main(){
  const intakePath = 'data/intakes.csv';
  const custPath   = 'data/customers.csv';

  if(!fs.existsSync(intakePath)){ console.log('no intakes'); process.exit(0); }

  const intake = parseCSV(fs.readFileSync(intakePath,'utf8'));
  ensureHeader(custPath, ['email','company','domain','delivery','vendors']);

  const cust = parseCSV(fs.readFileSync(custPath,'utf8'));

  const key = (o)=>`${(o.email||'').toLowerCase()}::${(o.domain||'').toLowerCase()}`;
  const have = new Set(cust.rows.map(key));

  // 识别 Plan 列（可选）
  const hasPlan = intake.header.map(h=>h.toLowerCase()).includes('plan');

  const promote = [];
  for(const r of intake.rows){
    if(have.has(key(r))) continue;
    if(hasPlan){
      const planKey = intake.header.find(h=>h.toLowerCase()==='plan');
      const plan = (r[planKey]||'').toLowerCase();
      // 仅推广 Portfolio/Business，企业/渠道保留你发票后再手动或二次推广
      if(!(plan.includes('portfolio') || plan.includes('business'))) continue;
    }
    promote.push({
      email: r.email||'',
      company: r.company||'',
      domain: r.domain||'',
      delivery: r.delivery||'Email only',
      vendors: r.vendors||''
    });
  }

  if(!promote.length){ console.log('no new customers'); return; }

  appendCSV(custPath, promote, ['email','company','domain','delivery','vendors']);
  console.log(`promoted ${promote.length} new customers`);
})();
