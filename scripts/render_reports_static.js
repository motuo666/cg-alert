
// Render Reports grid statically at build time (idempotent, regex-safe)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.ROOT || process.cwd();
const INDEX = path.join(ROOT, 'reports', 'index.html');
const FEED  = path.join(ROOT, 'reports', 'feed.json');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.writeFileSync(p, s); }

function buildCards(items){
  const fmt = (s)=> (s||'').toString().trim();
  const list = Array.isArray(items) ? items : (items && items.items) || [];
  const filtered = list.filter(it => ((it.url || it.page || '').indexOf('/reports/cards/') >= 0));
  if (!filtered.length) return '';
  return filtered.map(it => {
    const vendor  = fmt(it.vendor) || 'Vendor';
    const date    = fmt(it.date);
    const sha     = fmt(it.sha256);
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
  // 1) Preferred: replace empty <div id="grid"...></div>
  const re1 = new RegExp('<div[^>]*\\bid=[\\"\\\']grid[\\"\\\'][^>]*>\\s*<\\/div>', 'i');
  if (re1.test(html)) {
    return html.replace(re1, (m) => m.replace(/>\\s*<\\/div>/i, '>\n' + cards + '\n</div>'));
  }
  // 2) Placeholder comment
  const re2 = /<!--\s*GRID-PLACEHOLDER\s*-->/i;
  if (re2.test(html)) {
    return html.replace(re2, `<div id="grid" class="cg-grid">\n${cards}\n</div>`);
  }
  // 3) Fallback: insert before </main>
  const re3 = /<\/main>/i;
  if (re3.test(html)) {
    return html.replace(re3, `<div id="grid" class="cg-grid">\n${cards}\n</div>\n</main>`);
  }
  // 4) Last resort: append to end of body
  const re4 = /<\/body>/i;
  if (re4.test(html)) {
    return html.replace(re4, `<div id="grid" class="cg-grid">\n${cards}\n</div>\n</body>`);
  }
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
