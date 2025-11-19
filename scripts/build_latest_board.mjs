
// Build a static board page showing latest N evidence cards from reports/index.json (or evidence list)
import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'reports');
const OUT_DIR = REPORTS_DIR;
const N = Number(process.env.LATEST_N || '12');

function loadIndexJson(){
  const idx1 = path.join(REPORTS_DIR, 'index.json');
  if (fs.existsSync(idx1)) {
    try {
      const data = JSON.parse(fs.readFileSync(idx1, 'utf-8'));
      if (Array.isArray(data.items)) return data.items;
      if (Array.isArray(data)) return data;
    } catch {}
  }
  // fallback: scan a flat evidence dir if present
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
  const cards = items.slice(0, N).map(cardHTML).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Latest Evidence — CG Alert</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="/assets/cg-theme.css" />
</head>
<body>
<main class="container">
  <h1>Latest Evidence</h1>
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
  const items = loadIndexJson();
  const html = pageHTML(items);
  const out = path.join(OUT_DIR, 'latest.html');
  fs.writeFileSync(out, html);
  console.log('[latest-board] wrote', out);
}
main();
