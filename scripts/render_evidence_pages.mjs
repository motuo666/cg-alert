// ESM script: scripts/render_evidence_pages.mjs
import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';

const SITE_ROOT = process.cwd();
const EVID_DIR = path.join(SITE_ROOT, 'evidence');
const OUT_DIR  = path.join(SITE_ROOT, 'reports', 'evidence');

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }

async function main() {
  let st;
  try { st = await fs.stat(EVID_DIR); } catch { console.log('render_evidence_pages: no evidence dir -> skip.'); return; }
  if (!st.isDirectory()) { console.log('render_evidence_pages: evidence path is not a directory -> skip.'); return; }

  const files = (await fs.readdir(EVID_DIR)).filter(f => f.endsWith('.json'));
  if (!files.length) { console.log('render_evidence_pages: no evidence files -> skip.'); return; }

  await ensureDir(OUT_DIR);

  for (const f of files) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(EVID_DIR, f), 'utf-8'));
      const id = j.id || path.basename(f, '.json');
      const title = j.vendor || j.url || id;
      const when = j.timestamp || j.date || '';
      const body = j.diff_html || '<p>(diff omitted)</p>';
      const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Evidence</title>
<link rel="canonical" href="/reports/evidence/${id}.html"><meta name="robots" content="index,follow">
</head><body><main style="max-width:960px;margin:2rem auto;padding:1rem;">
<h1>${title}</h1>${when ? `<p><small>${when}</small></p>` : ''}
<article>${body}</article>
<p><a href="/reports/">← Back to Reports</a></p>
</main></body></html>`;
      await fs.writeFile(path.join(OUT_DIR, `${id}.html`), html, 'utf-8');
    } catch (e) {
      console.warn('render_evidence_pages: failed for', f, e.message);
    }
  }
  console.log(`render_evidence_pages: wrote ${files.length} evidence pages.`);
}

main().catch(err => { console.error(err); process.exit(1); });
