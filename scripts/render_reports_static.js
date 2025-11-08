#!/usr/bin/env node
/**
 * Render public/reports/index.html by injecting cards from evidence/*.json.
 * Safe no-op if templates or data are missing. Always exits 0.
 */
const fs = require('fs');
const path = require('path');

function findRoot() {
  if (fs.existsSync('cg-alert-main')) return 'cg-alert-main';
  return '.';
}

function readJSONFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const p = path.join(dir, file);
    try {
      const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
      out.push(obj);
    } catch { /* skip bad json */ }
  }
  return out;
}

function loadHTML(root) {
  const candidates = [
    path.join(root, 'public', 'reports', 'index.html'),
    path.join(root, 'reports', 'index.html'),
    path.join(root, 'public', 'reports.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return { file: p, html: fs.readFileSync(p, 'utf8') };
  }
  return null;
}

function escapeHTML(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildCards(items) {
  let cards = '';
  for (const it of items) {
    const vendor = it.vendor || it.name || it.domain || '';
    const url    = it.url || it.link || '#';
    const when   = it.timestamp || it.time || it.date || '';
    const gist   = it.change || it.summary || it.title || '';
    cards += [
      '<a class="card" href="', escapeHTML(url), '" target="_blank" rel="noopener">',
      '<h3>', escapeHTML(vendor), '</h3>',
      '<p>', escapeHTML(when), '</p>',
      '<p>', escapeHTML(gist), '</p>',
      '</a>\n'
    ].join('');
  }
  return cards || '<p class="muted">No evidence yet.</p>';
}

(function main() {
  try {
    const root = findRoot();
    const data = readJSONFiles(path.join(root, 'evidence'));
    const tpl  = loadHTML(root);
    if (!tpl) process.exit(0);
    const cards = buildCards(data);

    const gridOpen   = /<div[^>]*id=["']grid["'][^>]*>/i;
    const gridCloser = />\s*<\/div>/i;

    let html = tpl.html;
    if (gridOpen.test(html) && gridCloser.test(html)) {
      let seen = false;
      html = html.replace(gridOpen, (m) => { seen = true; return m; });
      if (seen) html = html.replace(gridCloser, () => '>\n' + cards + '\n</div>');
    } else {
      html = html.replace(/<\/main>/i, '<div id="grid">\n' + cards + '\n</div>\n</main>');
    }

    fs.mkdirSync(require('path').dirname(tpl.file), { recursive: true });
    fs.writeFileSync(tpl.file, html);
    process.exit(0);
  } catch {
    process.exit(0);
  }
})();