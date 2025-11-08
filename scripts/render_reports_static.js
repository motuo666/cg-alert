
/**
 * render_reports_static.js
 * Safe, Node 20-friendly static renderer for /reports/index.html
 * - No regex literals (avoids delimiter pitfalls)
 * - Robust fallbacks (id="grid", <!-- GRID-PLACEHOLDER -->, </main>, </body>)
 * - Non-throwing on missing files
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ROOT || '.';
const FEED_PATHS = [
  path.join(ROOT, 'reports', 'feed.json'),
  path.join(ROOT, 'cg-alert-main', 'reports', 'feed.json'),
];
const INDEX_PATHS = [
  path.join(ROOT, 'reports', 'index.html'),
  path.join(ROOT, 'cg-alert-main', 'reports', 'index.html'),
];

function readFirst(paths) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return {path: p, text: fs.readFileSync(p, 'utf8')};
    } catch {}
  }
  return null;
}

function toCards(items) {
  const esc = (s='') => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const SANE_LIMIT = 500;
  let out = [];
  for (const it of items.slice(0, SANE_LIMIT)) {
    const href = it.href || (it.id ? `/reports/cards/${esc(it.id)}.html` : '#');
    const title = esc(it.title || it.vendor || 'Update');
    const vendor = esc(it.vendor || '');
    const ts = esc(it.ts || it.date || '');
    out.push(
`<a class="card" href="${href}">
  <div class="card-body">
    <div class="card-title">${title}</div>
    <div class="card-meta">${vendor}${vendor && ts ? ' · ' : ''}${ts}</div>
  </div>
</a>`);
  }
  return out.join('\n');
}

function insertCards(html, cards) {
  // 1) Try <div id="grid">...</div> capture
  const reGrid = new RegExp('(<div[^>]*\\bid=["\\\']grid["\\\'][^>]*>)\\s*(</div>)', 'i');
  if (reGrid.test(html)) {
    return html.replace(reGrid, (m, open, close) => `${open}\n${cards}\n${close}`);
  }
  // 2) Try placeholder
  if (html.includes('<!-- GRID-PLACEHOLDER -->')) {
    return html.replace('<!-- GRID-PLACEHOLDER -->', `<div id="grid">\n${cards}\n</div>`);
  }
  // 3) Before </main>
  const reMain = new RegExp('</main>', 'i');
  if (reMain.test(html)) {
    return html.replace(reMain, `\n<div id="grid">\n${cards}\n</div>\n</main>`);
  }
  // 4) Before </body>
  const reBody = new RegExp('</body>', 'i');
  if (reBody.test(html)) {
    return html.replace(reBody, `\n<div id="grid">\n${cards}\n</div>\n</body>`);
  }
  // 5) Fallback: append
  return html + `\n<div id="grid">\n${cards}\n</div>\n`;
}

(function main() {
  const feed = readFirst(FEED_PATHS);
  const index = readFirst(INDEX_PATHS);

  if (!index) {
    console.log('[reports] index.html not found, skip.');
    process.exit(0);
  }
  if (!feed) {
    console.log('[reports] feed.json not found, keep index as-is.');
    process.exit(0);
  }

  let data;
  try {
    data = JSON.parse(feed.text);
  } catch (e) {
    console.log('[reports] bad feed.json JSON, skip. err=', e.message);
    process.exit(0);
  }
  const items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
  if (!items.length) {
    console.log('[reports] no items to render, keep index as-is.');
    process.exit(0);
  }

  const cards = toCards(items);
  const updated = insertCards(index.text, cards);
  if (updated !== index.text) {
    fs.writeFileSync(index.path, updated);
    console.log(`[reports] ${path.relative(process.cwd(), index.path)} updated with ${items.length} items.`);
  } else {
    console.log('[reports] index unchanged (no placeholder found).');
  }
})();
