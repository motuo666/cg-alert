#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import glob from 'glob';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SRC_DIR = path.join(ROOT, 'evidence');
const OUT_ROOT = path.join(ROOT, 'public', 'evidence');
fs.mkdirSync(OUT_ROOT, { recursive: true });

const escapeHtml = (str='') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\"/g, '&quot;');

function renderEvidencePage(meta) {
  const { vendor, type, url, kind, detected_at, etag, last_modified, sha256, hash, commit } = meta;
  const snapHash = sha256 || hash || '';
  const dt = new Date(detected_at || Date.now());
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth()+1).padStart(2,'0');
  const dd = String(dt.getUTCDate()).padStart(2,'0');
  const monthDir = `${yyyy}-${mm}`;
  const rawCapturePath = snapHash ? `/evidence/${monthDir}/${vendor}/${snapHash}/index.html` : '#';

  const rows = [
    ['Vendor', vendor||''],
    ['Type', type||''],
    ['Kind', kind||''],
    ['Source URL', url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>` : ''],
    ['Captured at (UTC)', detected_at||''],
    ['Raw capture', snapHash ? `<a href="${rawCapturePath}" target="_blank" rel="noopener">${escapeHtml(rawCapturePath)}</a>` : ''],
    ['SHA256', snapHash],
    ['Commit', commit||''],
    ['ETag', etag||''],
    ['Last-Modified', last_modified||''],
  ];

  const tableRows = rows.map(([k,v]) => `
    <tr>
      <th style="text-align:left;vertical-align:top;padding:.5rem .75rem;border-bottom:1px solid var(--border);white-space:nowrap;font-weight:600;color:var(--ink);font-size:.8rem;">${escapeHtml(k)}</th>
      <td style="padding:.5rem .75rem;border-bottom:1px solid var(--border);font-size:.8rem;line-height:1.4;color:var(--ink);word-break:break-word;">${v}</td>
    </tr>`).join('');

  const titleText = `${vendor||''} ${type||''} (${yyyy}-${mm}-${dd}) • CG Alert Evidence`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(titleText)}</title>
<link rel="stylesheet" href="/assets/cg-theme.css">
<link rel="stylesheet" href="/assets/cg-theme-hotfix.css">
</head>
<body>
<!--APP_HEADER-->
<main class="wrap" style="max-width:900px;margin:0 auto;padding:2rem 1rem;">
  <h1 style="font-size:1.25rem;font-weight:600;margin:0 0 1rem;color:var(--ink);line-height:1.3;">
    ${escapeHtml(vendor||'')}
    <span style="font-weight:400;color:#6b7280;">— ${escapeHtml(type||'')}</span>
    <span style="font-weight:400;color:#6b7280;">(${escapeHtml(detected_at||'')})</span>
  </h1>
  <div class="card" style="background:#fff;border:1px solid var(--border);border-radius:var(--radius-card);box-shadow:0 8px 24px rgba(0,0,0,.04);overflow:hidden;">
    <table style="width:100%;border-collapse:collapse;background:#fff;">
      <tbody>${tableRows}</tbody>
    </table>
  </div>
  <p style="margin-top:1rem;font-size:.75rem;color:#6b7280;line-height:1.4;">
    Evidence is captured from public/unauthenticated sources only (Pricing, ToS/MSA, DPA, Subprocessors, Status, etc).
    Timestamped for Procurement / Legal Ops / Finance audit. Not legal advice.
  </p>
</main>
<!--APP_FOOTER-->
</body></html>`;
}

function buildAll(){
  const files = glob.sync(path.join(SRC_DIR, '**/*.json'));
  files.forEach(fp => {
    let meta; try { meta = JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return; }
    const vendor = meta.vendor; if(!vendor) return;
    const outDir = path.join(OUT_ROOT, vendor);
    fs.mkdirSync(outDir, { recursive: true });
    const base = path.basename(fp).replace(/\.json$/i, '.html');
    const outFile = path.join(outDir, base);
    fs.writeFileSync(outFile, renderEvidencePage(meta), 'utf8');
  });
  console.log('✅ pretty evidence pages generated.');
}
buildAll();
