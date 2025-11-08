#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.env.ROOT || '.';
const reportsHtml = path.join(root, 'public', 'reports', 'index.html');
const evidenceDir = path.join(root, 'evidence');

function escHtml(s){ return String(s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function escAttr(s){ return String(s||'').replace(/"/g,'&quot;'); }

try {
  if (!fs.existsSync(reportsHtml)) {
    console.log('render_reports_static: no reports HTML, skip.');
    process.exit(0);
  }
  let cards = '';
  if (fs.existsSync(evidenceDir)) {
    const entries = fs.readdirSync(evidenceDir).filter(n => n.endsWith('.json')).slice(0, 500);
    for (const name of entries) {
      try {
        const obj = JSON.parse(fs.readFileSync(path.join(evidenceDir, name), 'utf8'));
        const vendor = obj.vendor || obj.domain || obj.title || name.replace(/\.json$/, '');
        const ts = obj.timestamp || obj.time || obj.date || '';
        const url = obj.url || (Array.isArray(obj.urls) ? obj.urls[0] : '') || '#';
        const hash = obj.hash || obj.sha256 || '';
        cards += `<article class="card">
  <h3>${escHtml(vendor)}</h3>
  <p><small>${escHtml(ts)} ${escHtml(hash)}</small></p>
  <p><a href="${escAttr(url)}" rel="nofollow">Source</a></p>
</article>\n`;
      } catch (_) {}
    }
  }
  let html = fs.readFileSync(reportsHtml, 'utf8');
  const re = /<div[^>]*id=["']cards["'][^>]*>[\s\S]*?<\/div>/i;
  if (re.test(html)) {
    html = html.replace(re, (m) => m.replace(/>\s*<\/div>/i, '>' + "\n" + cards + "\n</div>"));
  }
  fs.writeFileSync(reportsHtml, html);
  console.log('render_reports_static: done.');
  process.exit(0);
} catch (e) {
  console.log('render_reports_static: soft-fail', String(e && e.stack || e));
  process.exit(0);
}
