const { fs, path } = require('./utils.js');
const PUB = path.join(process.cwd(), process.env.PUBLISH_DIR || 'public');
const EVD = path.join(process.cwd(),'evidence');

function esc(s){ return String(s||'').replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function slug(v){ return (v||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'unknown'; }

async function loadTopVendors(n=2){
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
  return Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,n).map(x=>x[0]);
}

function page(title, vendor){
  const vslug = slug(vendor);
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="How to turn public vendor changes into renewal leverage.">
<style>body{font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial;margin:24px;color:#0b0f19}a{color:#0b62f2}</style>
</head><body>
<h1>${esc(title)}</h1>
<p>Use timestamped evidence (URL + time + hash) to push back on price uplifts and liability changes at renewal.</p>
<p><a href="/vendors/${vslug}/timeline.html">See ${esc(vendor)} timeline →</a></p>
<p><a href="/pricing/">Buy Portfolio</a> to enable alerts.</p>
</body></html>`;
}

(async function(){
  const OUT = path.join(PUB,'cases');
  const vendors = await loadTopVendors(2);
  await fs.mkdir(OUT,{recursive:true});
  const links = [];
  for(const v of vendors){
    const file = path.join(OUT, slug(v)+'.html');
    await fs.writeFile(file, page('Case — '+v, v), 'utf8');
    links.push(`<li><a href="/cases/${slug(v)}.html">${esc(v)}</a></li>`);
  }
  const idx = `<!doctype html><meta charset="utf-8"><title>Cases — CG Alert</title><ul>${links.join('')}</ul>`;
  await fs.writeFile(path.join(OUT,'index.html'), idx, 'utf8');
  console.log('cases generated', vendors.length);
})().catch(e=>{ console.error(e); process.exit(1); });
