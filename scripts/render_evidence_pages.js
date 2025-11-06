// CJS; Node 18+/20+; publishes HTML evidence pages with JSON-LD
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = process.cwd();
const PUB_DIR = path.join(ROOT, process.env.PUBLISH_DIR || 'public');
const EVD_DIR = path.join(ROOT, 'evidence');
const OUT_DIR = path.join(PUB_DIR, 'evidence');

function esc(s){ return String(s||'').replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function slugify(v){ return (v||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'unknown'; }

function html(title, body){
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="canonical" href="/evidence/">
<meta name="description" content="Timestamped, hash-verifiable vendor change evidence.">
<style>
  body{font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial;margin:0;color:#0b0f19}
  header,main{max-width:960px;margin:0 auto;padding:24px}
  a{color:#0b62f2} pre{white-space:pre-wrap;word-wrap:break-word;background:#f8fafc;border:1px solid #e5e7eb;padding:12px;border-radius:12px}
  .crumbs{font-size:14px;color:#475569}
  .grid{display:grid;grid-template-columns:1fr;gap:12px}
  .card{border:1px solid #e5e7eb;border-radius:16px;padding:16px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.03)}
</style>
</head><body>
<header class="crumbs"><a href="/">Home</a> › <a href="/vendors/">Vendors</a> › <a href="/evidence/">Evidence</a></header>
<main>${body}</main>
</body></html>`;
}

async function readEvidence(){
  try{
    const files = (await fs.readdir(EVD_DIR)).filter(f=>f.endsWith('.json'));
    const rows = [];
    for(const f of files){
      try{
        const j = JSON.parse(await fs.readFile(path.join(EVD_DIR,f),'utf8'));
        if(j && j.vendor && j.url && j.sha256){
          j._file = f;
          rows.push(j);
        }
      }catch{}
    }
    rows.sort((a,b)=> String(b.ts||'').localeCompare(String(a.ts||'')));
    return rows;
  }catch{ return []; }
}

async function writeItem(e){
  const vendorSlug = slugify(e.vendor);
  const idSlug = slugify(e.id || e.sha256.slice(0,16));
  const outDir = path.join(OUT_DIR, vendorSlug);
  await fs.mkdir(outDir,{recursive:true});
  const url = `/evidence/${vendorSlug}/${idSlug}.html`;
  const ld = {
    "@context":"https://schema.org",
    "@type":"Article",
    "headline": `${e.vendor} change evidence`,
    "about": e.vendor,
    "datePublished": e.ts || new Date().toISOString(),
    "url": url,
    "mainEntityOfPage": e.url,
    "identifier": e.sha256,
    "articleBody": (e.snippet || "").slice(0, 5000)
  };
  const body = `
<h1>Evidence — ${esc(e.vendor)}</h1>
<p><strong>Captured:</strong> ${esc(e.ts||'')} · <strong>Source:</strong> <a href="${esc(e.url)}" rel="nofollow">${esc(e.url)}</a></p>
<p><strong>SHA-256:</strong> <code>${esc(e.sha256)}</code></p>
<div class="card"><pre>${esc((e.snippet||'').slice(0,8000))}</pre></div>
<p><a href="/vendors/${vendorSlug}/">See recent changes for ${esc(e.vendor)} →</a></p>
<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  await fs.writeFile(path.join(outDir, `${idSlug}.html`), html(`Evidence — ${e.vendor}`, body), 'utf8');
  return { vendorSlug, idSlug, url, ts: e.ts };
}

async function writeIndex(items){
  const list = items.slice(0,200).map(e=>`<li><a href="/evidence/${e.vendorSlug}/${e.idSlug}.html">${e.vendorSlug}</a> · ${esc(e.ts||'')}</li>`).join('');
  const body = `<h1>Evidence</h1><ul class="grid">${list || '<li>No evidence yet</li>'}</ul>`;
  await fs.mkdir(OUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUT_DIR,'index.html'), html('Evidence — CG Alert', body), 'utf8');
}

(async function(){
  const evs = await readEvidence();
  const written = [];
  for(const e of evs){
    const meta = await writeItem(e);
    written.push(meta);
  }
  await writeIndex(written);
  console.log('evidence pages', written.length, '->', OUT_DIR);
})().catch(e=>{ console.error(e); process.exit(1); });
