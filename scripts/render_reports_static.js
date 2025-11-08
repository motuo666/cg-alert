// Render Reports grid statically at build time (idempotent)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const INDEX = path.join(ROOT, 'reports', 'index.html');
const FEED  = path.join(ROOT, 'reports', 'feed.json');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.writeFileSync(p, s); }

function buildCards(items){
  const fmt = (s)=> (s||'').toString().trim();
  const list = Array.isArray(items) ? items : (items && items.items) || [];
  // Only show valid cards
  const filtered = list.filter(it => (it.url || it.page || '').includes('/reports/cards/'));
  if (!filtered.length) return '';
  return filtered.map(it => {
    const vendor  = fmt(it.vendor) || 'Vendor';
    const date    = fmt(it.date);
    const sha     = fmt(it.sha256);
    const title   = fmt(it.title) || (vendor ? vendor + ' update' : 'Change detected');
    const snippet = fmt(it.summary || it.snippet);
    const href    = fmt(it.url || it.page || '#');
    const meta    = vendor + (date ? ' · ' + date : '') + (sha ? ' · SHA256 ' + sha.slice(0,8) + '…' : '');
    return `<a class="cg-card hover" href="${href}">
  <div class="card-meta">${meta}</div>
  <h3>${title}</h3>
  <p>${snippet}</p>
</a>`;
  }).join('\n');
}

function main(){
  if (!fs.existsSync(INDEX)) {
    console.log('reports/index.html not found; skip');
    return;
    }
  if (!fs.existsSync(FEED)) {
    console.log('reports/feed.json not found; skip');
    return;
  }
  let feed;
  try {
    feed = JSON.parse(read(FEED));
  } catch (e) {
    console.log('bad feed.json; skip', e.message);
    return;
  }
  const cards = buildCards(feed);
  if (!cards) { console.log('no cards to render'); return; }

  let html = read(INDEX);
  // Replace the empty grid with cards (idempotent)
  html = html.replace(
    /<div\\s+id=["']grid["'][^>]*>\\s*<\\/div>/i,
    (m)=> `<div id="grid" class="cg-grid">\\n${cards}\\n</div>`
  );
  write(INDEX, html);
  console.log('reports/index.html updated with', (cards.match(/<a\\s+class="cg-card/g)||[]).length, 'cards');
}

if (require.main === module) main();
