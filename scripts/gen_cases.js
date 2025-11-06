import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const EVD = path.join(ROOT,'evidence');
const OUT = path.join(ROOT,'public','cases');

function page(title, body){
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<link rel="canonical" href="/cases/"><style>body{font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial;margin:24px;color:#0b0f19}h1{margin:0 0 8px}a{color:#0b62f2}</style>${body}`;
}

async function pickTopVendors(n=2){
  const map = new Map();
  try{
    const files = (await fs.readdir(EVD)).filter(f=>f.endsWith('.json'));
    for(const f of files){
      try{
        const e = JSON.parse(await fs.readFile(path.join(EVD,f),'utf8'));
        const k = e.vendor || 'unknown';
        map.set(k, (map.get(k)||0)+1);
      }catch{}
    }
  }catch{}
  const arr = Array.from(map.entries()).sort((a,b)=>b[1]-a[1]);
  if(arr.length < n){
    while(arr.length < n) arr.push([`example-${arr.length+1}.com`, 0]);
  }
  return arr.slice(0,n).map(x=>x[0]);
}

async function main(){
  await fs.mkdir(OUT,{recursive:true});
  const vendors = await pickTopVendors(2);
  for(const v of vendors){
    const html = page(`Case — ${v}`, `<h1>Case — ${v}</h1>
<p>How to leverage verified changes at <strong>${v}</strong> during renewal.</p>
<ol>
  <li>Reference timestamped evidence cards.</li>
  <li>Paste escalation language to request credits/legacy terms.</li>
  <li>Loop legal/RevOps only when needed.</li>
</ol>
<p><a href="/vendors/${v.replace(/[^a-z0-9]+/gi,'-')}/">See recent changes →</a></p>`);
    await fs.writeFile(path.join(OUT, `${v.replace(/[^a-z0-9]+/gi,'-')}.html`), html, 'utf8');
  }
  // index
  const links = vendors.map(v=>`<li><a href="/cases/${v.replace(/[^a-z0-9]+/gi,'-')}.html">${v}</a></li>`).join('');
  await fs.writeFile(path.join(OUT,'index.html'), page('Cases — CG Alert', `<h1>Cases</h1><ul>${links}</ul>`));
  console.log('cases generated', vendors.length);
}
main().catch(e=>{ console.error(e); process.exit(1); });
