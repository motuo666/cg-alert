// CJS; builds per-vendor timelines into PUBLISH_DIR
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = process.cwd();
const PUB_DIR = path.join(ROOT, process.env.PUBLISH_DIR || 'public');
const EVD_DIR = path.join(ROOT, 'evidence');
const OUT_DIR = path.join(PUB_DIR,'vendors');

function slugify(v){ return (v||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'unknown'; }
function esc(s){ return String(s||'').replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function html(title, body){
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="canonical" href="/vendors/">
<style>
  body{font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial;margin:0;color:#0b0f19}
  header,main{max-width:960px;margin:0 auto;padding:24px}
  a{color:#0b62f2}
  .item{border-left:3px solid #0b62f2;margin:12px 0;padding:6px 12px;background:#f8fafc;border-radius:8px}
</style>
</head><body>
<header><a href="/vendors/">Vendors</a></header>
<main>${body}</main>
</body></html>`;
}

async function loadEvidence(){
  const map = new Map(); // vendorSlug -> items[]
  try{
    const files = (await fs.readdir(EVD_DIR)).filter(f=>f.endsWith('.json'));
    for(const f of files){
      try{
        const e = JSON.parse(await fs.readFile(path.join(EVD_DIR,f),'utf8'));
        const vs = slugify(e.vendor);
        const id = (e.id || e.sha256 || f).toString().toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40);
        const url = `/evidence/${vs}/${id}.html`;
        const item = { ts: e.ts || '', src: e.url || '#', url, sha: e.sha256 || '', snippet: (e.snippet||'').slice(0,240) };
        if(!map.has(vs)) map.set(vs, []);
        map.get(vs).push(item);
      }catch{}
    }
  }catch{}
  for(const [k,arr] of map.entries()) arr.sort((a,b)=>String(b.ts).localeCompare(String(a.ts)));
  return map;
}

(async function(){
  const vendors = await loadEvidence();
  for(const [vs, items] of vendors.entries()){
    const dir = path.join(OUT_DIR, vs);
    await fs.mkdir(dir,{recursive:true});
    const body = `<h1>${esc(vs)} — Timeline</h1>`+
      (items.length? items.map(i=>`<div class="item">
      <div><strong>${esc(i.ts||'')}</strong> · <a href="${esc(i.src)}" rel="nofollow">source</a> · <a href="${esc(i.url)}">evidence</a></div>
      <div>${esc(i.snippet)}</div></div>`).join('') : '<p>No events yet.</p>') +
      `<p><a href="/vendors/">← All vendors</a> · <a href="/evidence/">All evidence</a> · <a href="/pricing/">Pricing</a> · <a href="/#compare">Compare</a></p>`;
    await fs.writeFile(path.join(dir,'timeline.html'), html(`${vs} — Timeline`, body), 'utf8');
    const idx = path.join(dir,'index.html');
    try{ await fs.access(idx); }catch{
      await fs.writeFile(idx, html(`${vs}`, `<h1>${esc(vs)}</h1><p><a href="/vendors/${vs}/timeline.html">See timeline →</a></p>`), 'utf8');
    }
  }
  const index = path.join(OUT_DIR,'index.html');
  try{ await fs.access(index); }catch{
    const links = Array.from(vendors.keys()).slice(0,500).map(v=>`<li><a href="/vendors/${v}/">${v}</a></li>`).join('');
    await fs.mkdir(OUT_DIR,{recursive:true});
    await fs.writeFile(index, html('Vendors', `<h1>Vendors</h1><ul>${links}</ul>`), 'utf8');
  }
  console.log('vendors timelines', vendors.size, '->', OUT_DIR);
})().catch(e=>{ console.error(e); process.exit(1); });
