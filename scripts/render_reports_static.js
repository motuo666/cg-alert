// Render Reports grid statically at build time (regex-safe, idempotent)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.ROOT || process.cwd();
const INDEX = path.join(ROOT, 'reports', 'index.html');
const FEED  = path.join(ROOT, 'reports', 'feed.json');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.writeFileSync(p, s); }

function buildCards(items){
  const fmt = (s)=> (s||'').toString().trim();
  let list = [];
  if (Array.isArray(items)) list = items;
  else if (items && Array.isArray(items.items)) list = items.items;

  // 只渲染指向 /reports/cards/ 的项，保证安全与一致
  const filtered = list.filter(it => ((it.url || it.page || '').includes('/reports/cards/')));
  if (!filtered.length) return '';

  return filtered.map(it => {
    const vendor  = fmt(it.vendor) || 'Vendor';
    const date    = fmt(it.date);
    const sha     = fmt(it.sha256 || it.sha || '');
    const title   = fmt(it.title) || (vendor ? vendor + ' update' : 'Change detected');
    const snippet = fmt(it.summary || it.snippet || it.excerpt);
    const href    = fmt(it.url || it.page || '#');
    const meta    = vendor + (date ? ' · ' + date : '') + (sha ? ' · SHA256 ' + sha.slice(0,8) + '…' : '');
    return `<a class="cg-card hover" href="${href}">
  <div class="card-meta">${meta}</div>
  <h3>${title}</h3>
  <p>${snippet}</p>
</a>`;
  }).join('\n');
}

function replaceGrid(html, cards){
  // 1) Replace empty <div id="grid"...></div>
  try {
    const re1 = new RegExp('<div[^>]*\\bid=["\\\']grid["\\\'][^>]*>\\s*<\\/div>', 'i');
    if (re1.test(html)) return html.replace(re1, (m) => m.replace(/>\\s*<\\/div>/i, '>\n' + cards + '\n</div>'));
  } catch {}

  // 2) Placeholder comment
  try {
    const re2 = /<!--\s*GRID-PLACEHOLDER\s*-->/i;
    if (re2.test(html)) return html.replace(re2, `<div id="grid" class="cg-grid">\n${cards}\n</div>`);
  } catch {}

  // 3) Before </main>
  try {
    const re3 = /<\/main>/i;
    if (re3.test(html)) return html.replace(re3, `<div id="grid" class="cg-grid">\n${cards}\n</div>\n</main>`);
  } catch {}

  // 4) Before </body>
  try {
    const re4 = /<\/body>/i;
    if (re4.test(html)) return html.replace(re4, `<div id="grid" class="cg-grid">\n${cards}\n</div>\n</body>`);
  } catch {}

  return html;
}

function main(){
  if (!fs.existsSync(INDEX)) { console.log('reports/index.html not found; skip'); return; }
  if (!fs.existsSync(FEED))  { console.log('reports/feed.json not found; skip'); return; }

  let feed;
  try { feed = JSON.parse(read(FEED)); }
  catch(e){ console.log('bad feed.json; skip', e.message); return; }

  const cards = buildCards(feed);
  if (!cards) { console.log('no cards to render'); return; }

  const before = read(INDEX);
  const after  = replaceGrid(before, cards);
  if (after !== before) {
    write(INDEX, after);
    const n = (cards.match(/<a\s+class="cg-card/g)||[]).length;
    console.log('reports/index.html updated with', n, 'cards');
  } else {
    console.log('reports/index.html unchanged');
  }
}

if (require.main === module) main();