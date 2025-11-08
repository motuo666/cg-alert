
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const EVIDENCE_DIR = 'evidence';
const REPORTS_DIR = 'reports';
const CARDS_DIR = path.join(REPORTS_DIR, 'cards');
const FEED_JSON = path.join(REPORTS_DIR, 'feed.json');
const RSS_XML = path.join('rss', 'index.xml');

function safeSlug(s) { return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }

async function readEvidence() {
  try {
    const files = await fs.readdir(EVIDENCE_DIR);
    const items = [];
    for (const f of files.filter(f=>f.endsWith('.json'))) {
      try {
        const raw = await fs.readFile(path.join(EVIDENCE_DIR, f), 'utf-8');
        const j = JSON.parse(raw);
        const vendor = j.vendor || j.name || j.title || path.basename(f, '.json');
        const url = j.url || j.source || j.link || '#';
        const capturedAt = j.captured_at || j.timestamp || j.time || new Date().toISOString();
        const hash = j.sha256 || j.hash || crypto.createHash('sha256').update(raw).digest('hex');
        const summary = j.summary || j.delta || j.change || '';
        items.push({ vendor, url, capturedAt, hash, summary, file: f, raw: j });
      } catch {}
    }
    items.sort((a,b)=> (b.capturedAt||'').localeCompare(a.capturedAt||''));
    return items;
  } catch { return []; }
}

function rfc822(d){ try { return new Date(d).toUTCString(); } catch { return new Date().toUTCString(); } }
function esc(s=''){ return s.replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c])); }

async function writeCards(items){
  await ensureDir(CARDS_DIR);
  const header = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Report — CG Alert</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/home-v3c.css">
</head><body>
<header class="cg-topbar"><div class="cg-wrap cg-nav">
<a class="cg-brand" href="/"><img src="/icon.svg" alt="CG Alert" width="40" height="40"><span>CG&nbsp;Alert</span></a>
<nav class="cg-links" id="topnav">
  <a href="/#pricing">Pricing</a>
  <a href="/#how">How it works</a>
  <a href="/#evidence">Evidence</a>
  <a href="/#compare">Compare</a>
  <a href="/#faq">FAQ</a>
</nav></div></header>`;
  const footer = `<footer class="cg-footer"><div class="cg-wrap cg-footlinks">
<a href="/who-uses/">Who uses</a><a href="/about/">About</a><a href="/reports/">Reports</a><a href="/rss/index.xml">RSS</a><a href="/terms/">Terms</a><a href="/privacy/">Privacy</a>
<span>© CG Alert — evidence-backed vendor change alerts.</span></div></footer>
<script src="/assets/home-v3c.js"></script>
</body></html>`;
  for (const it of items) {
    const slug = safeSlug(`${it.vendor}-${it.capturedAt}`) || safeSlug(it.file);
    const out = path.join(CARDS_DIR, `${slug}.html`);
    const body = `<section class="cg-wrap">
<article class="cg-evi-card hover">
  <div class="cg-evi-meta">Source URL: ${esc(it.url)} · Captured: ${esc(it.capturedAt)} · SHA256: ${esc(it.hash)}</div>
  <h3>${esc(it.vendor)}</h3>
  <p>${esc(it.summary || 'Change captured.')}</p>
  <pre class="cg-raw">${esc(JSON.stringify(it.raw, null, 2))}</pre>
</article>
</section>`;
    await fs.writeFile(out, header + body + footer, 'utf-8');
    it.card = `/reports/cards/${path.basename(out)}`;
  }
}

async function writeFeed(items){
  await ensureDir(REPORTS_DIR);
  const data = { generated_at: new Date().toISOString(), items: items.map(it=>({vendor: it.vendor, url: it.card || it.url, date: it.capturedAt, summary: it.summary})) };
  await fs.writeFile(FEED_JSON, JSON.stringify(data, null, 2), 'utf-8');
}

async function writeRSS(items){
  await ensureDir('rss');
  const itemsXML = items.map(it=>`
  <item>
    <title>${esc(it.vendor)}</title>
    <link>${esc(it.card || it.url)}</link>
    <pubDate>${esc(rfc822(it.capturedAt))}</pubDate>
    <description>${esc(it.summary || '')}</description>
    <guid isPermaLink="false">${esc(it.hash)}</guid>
  </item>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>CG Alert Reports</title>
<link>https://www.cg-alert.com/reports/</link>
<description>Evidence-backed vendor change alerts</description>
<lastBuildDate>${rfc822(new Date().toISOString())}</lastBuildDate>
${itemsXML}
</channel></rss>`;
  await fs.writeFile(RSS_XML, xml, 'utf-8');
}

async function main(){
  const items = await readEvidence();
  await writeCards(items);
  await writeFeed(items);
  await writeRSS(items);
  console.log(`reports build complete: ${items.length} items`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
