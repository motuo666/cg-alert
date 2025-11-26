
// Build a static board page showing latest N evidence cards from reports/index.json (or evidence list)
import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'reports');
const OUT_DIR = REPORTS_DIR;
const N = Number(process.env.LATEST_N || '12');

function loadItems(){
  const feedPath = path.join(REPORTS_DIR, 'feed.json');
  if (fs.existsSync(feedPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(feedPath, 'utf-8'));
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.items)) return data.items;
    } catch {}
  }
  const idxPath = path.join(REPORTS_DIR, 'index.json');
  if (fs.existsSync(idxPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.items)) return data.items;
    } catch {}
  }
  return [];
}

function cardHTML(it){
  const title = it.title || `${it.vendor || ''} ${it.path || ''}`.trim();
  const href = it.url || it.permalink || (it.id ? `/reports/e/${encodeURIComponent(it.id)}.html` : '#');
  const when = it.date || it.updated_at || it.timestamp || '';
  const preview = (it.summary || it.snippet || '').slice(0, 180);
  return `<article class="evidence-card">
  <h4><a href="${href}">${title}</a></h4>
  <time>${when}</time>
  <p>${preview}</p>
</article>`;
}

function pageHTML(items){
  const cards = items.slice(0, N).map(cardHTML).join(String.fromCharCode(10));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Latest evidence — CG Alert</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<link rel="canonical" href="https://www.cg-alert.com/reports/latest.html" />
<link rel="stylesheet" href="/assets/home-v3c.css" />
<meta name="description" content="Browse the latest vendor change evidence captured by CG Alert." />
</head>
<body>
<header class="cg-topbar">
  <div class="cg-wrap cg-nav">
    <a class="cg-brand" href="/"><img src="/icon.svg" alt="CG Alert" width="40" height="40" /><span>CG&nbsp;Alert</span></a>
    <nav class="cg-links" id="topnav">
      <a href="/#pricing">Pricing</a>
      <a href="/#how">How it works</a>
      <a href="/#evidence">Evidence</a>
      <a href="/#compare">Compare</a>
      <a href="/#faq">FAQ</a>
    </nav>
  </div>
</header>
<main class="cg-wrap">
  <h1>Latest evidence</h1>
  <p class="cg-note">A snapshot of recently captured vendor change evidence. For full search and filters, see the main <a href="/reports/">reports page</a>.</p>
  <section class="cards-grid">
    ${cards || '<p>No recent evidence.</p>'}
  </section>
</main>
<style>
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin:18px 0;}
.evidence-card{border:1px solid #e5e5e5;border-radius:10px;padding:12px;background:#fff}
.evidence-card h4{margin:0 0 6px;font-size:16px;line-height:1.25}
.evidence-card time{display:block;color:#777;font-size:12px;margin-bottom:6px}
.evidence-card p{margin:0;color:#444;font-size:13px;line-height:1.4}
</style>
</body>
</html>`;
}


function main(){
  const items = loadItems();
  const html = pageHTML(items);
  const out = path.join(OUT_DIR, 'latest.html');
  fs.writeFileSync(out, html);
  console.log('[latest-board] wrote', out);
}
main();