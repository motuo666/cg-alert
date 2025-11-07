
// Render /reports and /rss even if no evidence exists.
import { promises as fs } from 'fs';
import path from 'path';

const PUBLISH_DIR = process.env.PUBLISH_DIR || '.';
const EVID_DIR = 'evidence';

async function readEvidence() {
  let items = [];
  async function walk(dir){
    const ents = await fs.readdir(dir, {withFileTypes:true}).catch(()=>[]);
    for (const ent of ents){
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (ent.isFile() && ent.name.endsWith('.json')) {
        try{
          const raw = await fs.readFile(p,'utf-8');
          const j = JSON.parse(raw);
          // expected fields: vendor, url, title, snippet, ts
          items.push({
            vendor: j.vendor || 'unknown',
            url: j.url || '',
            title: j.title || j.vendor || 'Change detected',
            snippet: j.snippet || '',
            ts: j.ts || new Date().toISOString(),
            link: j.link || j.url || '',
          });
        }catch{}
      }
    }
  }
  await walk(EVID_DIR);
  // newest first
  items.sort((a,b)=> String(b.ts).localeCompare(String(a.ts)));
  return items;
}

function htmlShell(title, content){
return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="/assets/style.css">
<link rel="stylesheet" href="/assets/overrides.css">
</head><body><div class="container">
<header class="header">
  <div class="logo"><img src="/icon.svg" alt="CG Alert"><span>CG Alert</span></div>
  <nav>
    <a href="/">Home</a>
    <a href="/pricing/">Pricing</a>
    <a href="/reports/">Reports</a>
    <a href="/about/">About</a>
    <a href="/terms/">Terms</a>
    <a href="/privacy/">Privacy</a>
  </nav>
</header>
${content}
<footer class="footer">
  <div>© CG Alert · <a href="/terms/">Terms</a> · <a href="/privacy/">Privacy</a> · Contact: <a href="mailto:ops@cg-alert.com">ops@cg-alert.com</a></div>
</footer>
</div></body></html>`;
}

function escapeHtml(s){ return String(s).replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }

async function renderReports(items){
  const cards = items.map(it=>`
    <article class="card">
      <h3>${escapeHtml(it.title)}</h3>
      <p class="small">${escapeHtml(it.snippet || '')}</p>
      <p class="small">${escapeHtml(it.vendor)} · ${escapeHtml(it.ts)}</p>
      <p><a class="btn" href="${escapeHtml(it.link || it.url || '#')}">View source</a></p>
    </article>
  `).join('');

  const body = `
    <section class="section">
      <h2>Recent vendor changes</h2>
      <p class="small">Subscribe <a href="/rss/index.xml">via RSS</a>.</p>
      <div class="cg-cards">${cards || '<div class="small">No reports yet.</div>'}</div>
    </section>`;

  const html = htmlShell('Reports · CG Alert', body);
  await fs.mkdir(path.join(PUBLISH_DIR,'reports'), {recursive:true});
  await fs.writeFile(path.join(PUBLISH_DIR,'reports','index.html'), html, 'utf-8');
}

async function renderRSS(items){
  const site = 'https://www.cg-alert.com';
  const now = new Date().toUTCString();
  const entries = items.slice(0,100).map(it=>`
    <item>
      <title>${escapeHtml(it.title)}</title>
      <link>${escapeHtml(it.link || it.url || site)}</link>
      <pubDate>${new Date(it.ts).toUTCString() || now}</pubDate>
      <description>${escapeHtml(it.snippet || '')}</description>
      <guid>${escapeHtml((it.link || it.url || site) + '#' + (it.ts || ''))}</guid>
    </item>`).join('');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CG Alert — Reports</title>
    <link>${site}/reports/</link>
    <description>Evidence-backed vendor change alerts</description>
    <lastBuildDate>${now}</lastBuildDate>
    ${entries}
  </channel>
</rss>`;

  await fs.mkdir(path.join(PUBLISH_DIR,'rss'), {recursive:true});
  await fs.writeFile(path.join(PUBLISH_DIR,'rss','index.xml'), rss, 'utf-8');
}

const items = await readEvidence();
await renderReports(items);
await renderRSS(items);
console.log(`Rendered reports (${items.length} items) and RSS.`);
