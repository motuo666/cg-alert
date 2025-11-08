#!/usr/bin/env node
/**
 * Render public/reports/index.html by injecting simple cards from evidence/*.json.
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
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      out.push({ file: f, data: j });
    } catch {}
  }
  return out;
}

function main() {
  const root = findRoot();
  const candidates = [
    path.join(root, 'public', 'reports', 'index.html'),
    path.join(root, 'reports', 'index.html'),
    path.join(root, 'public', 'reports.html'),
  ];
  let target = candidates.find((p) => fs.existsSync(p));
  if (!target) {
    console.log('render_reports_static: no reports template found, noop');
    process.exit(0);
  }

  let html = fs.readFileSync(target, 'utf8');
  const marker = '<div id="grid"></div>';
  if (!html.includes(marker)) {
    console.log('render_reports_static: marker not found, noop');
    process.exit(0);
  }

  const evidenceDir = path.join(root, 'evidence');
  const items = readJSONFiles(evidenceDir);
  let cards = '';

  for (const { data, file } of items) {
    const vendor = data.vendor || data.domain || file.replace(/\.json$/,'');
    const url = data.url || (Array.isArray(data.urls) ? data.urls[0] : '') || '#';
    const when = data.timestamp || data.ts || '';
    const gist = data.change || data.summary || '';
    cards += `<a class="card" href="${url}" target="_blank" rel="noopener">
<h3>${vendor}</h3>
<p>${when}</p>
<p>${gist}</p>
</a>\n`;
  }

  if (!cards) {
    cards = '<p class="muted">No evidence yet.</p>';
  }

  html = html.replace(marker, `<div id="grid">\n${cards}</div>`);

  // Always write to public/reports/index.html to be safe
  const outPath = path.join(root, 'public', 'reports', 'index.html');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log('render_reports_static: wrote', outPath);
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.log('render_reports_static: soft-fail:', e && e.message || e);
  process.exit(0);
}
