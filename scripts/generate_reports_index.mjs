// ESM script: scripts/generate_reports_index.mjs
import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';

const SITE_ROOT = process.cwd();
const REPORTS_DIR = path.join(SITE_ROOT, 'reports');
const EVID_DIR = path.join(REPORTS_DIR, 'evidence');

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }

async function main() {
  await ensureDir(REPORTS_DIR);
  let items = [];
  try {
    const files = await fs.readdir(EVID_DIR);
    for (const f of files) if (f.endsWith('.html')) items.push({ id: f.replace(/\.html$/, ''), href: `/reports/evidence/${f}` });
  } catch {}

  const listHtml = items.map(x => `<li><a href="${x.href}">${x.id}</a></li>`).join('');
  const body = items.length ? `<ul>${listHtml}</ul>` :
    `<p>No evidence yet. This page updates automatically when new changes are captured.</p>`;

  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reports — CG Alert</title>
<link rel="canonical" href="/reports/"><meta name="robots" content="index,follow">
</head><body><main style="max-width:960px;margin:2rem auto;padding:1rem;">
<h1>Vendor Change Reports</h1>${body}
</main></body></html>`;

  await fs.writeFile(path.join(REPORTS_DIR, 'index.html'), html, 'utf-8');
  console.log(`reports index written (${items.length} item(s)).`);
}

main().catch(err => { console.error(err); process.exit(1); });
