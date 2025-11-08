// scripts/reports_build.mjs  (Node 20 ESM)
import fs from 'fs/promises';
import path from 'path';

const EVID_DIR = 'evidence';
const OUT_CARDS = 'reports/cards';
const OUT_FEED = 'reports/feed.json';
const OUT_RSS = 'rss/index.xml';

const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';

const brandHeader = `
<header class="cg-topbar">
  <div class="cg-wrap cg-nav">
    <a class="cg-brand" href="/"><img src="/icon.svg" alt="CG Alert" width="40" height="40"><span>CG&nbsp;Alert</span></a>
    <nav class="cg-links" id="topnav">
      <a href="/#pricing">Pricing</a>
      <a href="/#how">How it works</a>
      <a href="/#evidence">Evidence</a>
      <a href="/#compare">Compare</a>
      <a href="/#faq">FAQ</a>
    </nav>
  </div>
</header>`;

const brandFooter = `
<footer class="cg-footer">
  <div class="cg-wrap cg-footlinks">
    <a href="/who-uses/">Who uses</a>
    <a href="/about/">About</a>
    <a href="/reports/">Reports</a>
    <a href="/rss/index.xml">RSS</a>
    <a href="/terms/">Terms</a>
    <a href="/privacy/">Privacy</a>
    <span>© CG Alert — evidence-backed vendor change alerts.</span>
  </div>
</footer>`;

async function ensureDir(p){ await fs.mkdir(p, {recursive:true}); }
async function cleanDir(p){
  try {
    const entries = await fs.readdir(p);
    await Promise.all(entries.map(e=>fs.rm(path.join(p,e), {recursive:true, force:true})));
  } catch{}
}

function slugify(s){
  return (s||'').toLowerCase()
    .replace(/https?:\/\//,'').replace(/[^\w\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
}

function asISO(ts){
  if (!ts) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(ts)) return ts;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

async function readEvidence(){
  let files=[];
  try{ files = (await fs.readdir(EVID_DIR)).filter(f=>f.endsWith('.json')); }catch{}
  const items=[];
  for (const f of files){
    const raw = await fs.readFile(path.join(EVID_DIR,f), 'utf8');
    let j; try{ j = JSON.parse(raw);}catch{continue;}
    const vendor = j.vendor || j.name || j.domain || '';
    const url = j.url || j.source || '';
    const title = j.title || `${vendor || url} — Change detected`;
    const ts = asISO(j.captured || j.timestamp || j.ts || Date.now());
    const sha = j.sha256 || (j.hash ? (''+j.hash) : '');
    const snippet = j.snippet || j.diff || j.summary || '';
    const slug = slugify(`${vendor}-${ts}-${url || f}`);
    items.push({slug, vendor, title, captured: ts, url, sha256: sha, snippet});
  }
  return items.sort((a,b)=> (b.captured||'').localeCompare(a.captured||''));
}

function cardHTML(it){
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${it.title}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/home-v3c.css">
<meta name="description" content="Evidence card for ${it.vendor}">
</head><body>
${brandHeader}
<section class="cg-wrap">
  <article class="cg-card">
    <div class="card-meta">${it.vendor} · ${it.captured} · ${it.sha256 ? ('SHA256 '+it.sha256) : ''}</div>
    <h1>${it.title}</h1>
    <p><b>Source:</b> <a href="${it.url}" rel="nofollow">${it.url}</a></p>
    ${it.snippet ? `<pre class="cg-raw">${it.snippet}</pre>` : ''}
  </article>
</section>
${brandFooter}
</body></html>`;
}

function rssXML(items){
  const itemsXml = items.map(it => `
    <item>
      <title>${escapeXml(it.title)}</title>
      <link>${SITE}/reports/cards/${it.slug}.html</link>
      <guid>${SITE}/reports/cards/${it.slug}.html</guid>
      <pubDate>${new Date(it.captured || Date.now()).toUTCString()}</pubDate>
      <description>${escapeXml(it.snippet || '')}</description>
    </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CG Alert Reports</title>
    <link>${SITE}/reports/</link>
    <description>Evidence-backed vendor change alerts</description>
    ${itemsXml}
  </channel>
</rss>`;
}
function escapeXml(s){return (s||'').replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));}

(async () => {
  await ensureDir(OUT_CARDS);
  await cleanDir(OUT_CARDS);
  const items = await readEvidence();

  // cards
  await Promise.all(items.map(it =>
    fs.writeFile(path.join(OUT_CARDS, `${it.slug}.html`), cardHTML(it), 'utf8')
  ));

  // feed.json
  await fs.writeFile(OUT_FEED, JSON.stringify(items.map(it => ({
    vendor: it.vendor, title: it.title, captured: it.captured,
    url: it.url, sha256: it.sha256, snippet: it.snippet,
    page: `/reports/cards/${it.slug}.html`
  })), null, 2), 'utf8');

  // rss.xml
  await fs.mkdir('rss', { recursive: true });
  await fs.writeFile(OUT_RSS, rssXML(items), 'utf8');

  console.log(`reports_build: cards=${items.length}`);
})();
