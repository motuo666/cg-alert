import { promises as fs } from 'fs';
import path from 'path';

const evidenceDir = 'evidence';
const outRoot = 'reports';
const head = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Report — CG Alert</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="canonical" href="https://www.cg-alert.com/"/>
<link rel="stylesheet" href="/assets/home-v3c.css">
</head><body>
<header class="cg-topbar">
  <div class="cg-wrap cg-nav">
    <a class="cg-brand" href="/"><img src="/icon.svg" alt="CG Alert" width="40" height="40"><span>CG&nbsp;Alert</span></a>
    <nav class="cg-links" id="topnav">
      <a href="/#pricing">Pricing</a>
      <a href="#how">How it works</a>
      <a href="#evidence">Evidence</a>
      <a href="#compare">Compare</a>
      <a href="#faq">FAQ</a>
    </nav>
  </div>
</header>`;
const foot = `<footer class="cg-footer">
  <div class="cg-wrap cg-footlinks">
    <a href="/who-uses/">Who uses</a>
    <a href="/about/">About</a>
    <a href="/reports/">Reports</a>
    <a href="/rss/index.html">RSS</a>
    <a href="/terms/">Terms</a>
    <a href="/privacy/">Privacy</a>
    <span>© CG Alert — evidence-backed vendor change alerts.</span>
  </div>
</footer>
<script src="/assets/home-v3c.js"></script>
</body></html>`;

let files = [];
try {
  files = await fs.readdir(evidenceDir);
} catch {
  files = [];
}
let count = 0;
for (const f of files) {
  if (!f.endsWith('.json')) continue;
  try {
    const raw = await fs.readFile(path.join(evidenceDir, f), 'utf-8');
    const j = JSON.parse(raw);
    const vendor = j.vendor || j.name || (j.url ? new URL(j.url).hostname : 'vendor');
    const when = j.timestamp || j.date || new Date().toISOString();
    const page = j.page || j.section || 'Change';
    const slug = (j.sha256 || j.hash || f.replace(/\.json$/,''));
    const vendorSlug = vendor.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$|--+/g,'');
    const datePart = (when || '').slice(0,10);
    const outDir = path.join(outRoot, vendorSlug, datePart);
    await fs.mkdir(outDir, { recursive: true });
    const title = `${vendor} — ${page}`;
    const snippet = (j.snippet || j.diff || j.note || '').toString();
    const url = j.url || j.link || '#';
    const html = `${head}
<section class="cg-wrap">
  <h1>${title}</h1>
  <p class="muted"><a href="${url}">Source</a> · <code>${when}</code> · <code>${slug}</code></p>
  <div class="cg-card"><pre style="white-space:pre-wrap">${snippet.replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]))}</pre></div>
</section>
${foot}`;
    await fs.writeFile(path.join(outDir, `${slug}.html`), html, 'utf-8');
    count++;
  } catch {
    // ignore bad json
  }
}
console.log(`rendered pages ${count}`);
