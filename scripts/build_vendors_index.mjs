import { promises as fs } from 'fs';
import path from 'path';

const evidenceDir = 'evidence';
const outDir = 'reports';
await fs.mkdir(outDir, { recursive: true });
const items = [];
let files = [];
try {
  files = await fs.readdir(evidenceDir);
} catch {
  files = [];
}
for (const f of files) {
  if (!f.endsWith('.json')) continue;
  try {
    const raw = await fs.readFile(path.join(evidenceDir, f), 'utf-8');
    const j = JSON.parse(raw);
    const vendor = j.vendor || j.name || (j.url ? new URL(j.url).hostname : 'vendor');
    const when = j.captured_at || j.timestamp || j.date || new Date().toISOString();
    const page = j.page || j.section || 'Change';
    const slug = (j.sha256 || j.hash || f.replace(/\.json$/,''));
    const vendorSlug = vendor.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$|--+/g,'');
    const datePart = (when || '').slice(0,10);
    const localPath = `/reports/${vendorSlug}/${datePart}/${slug}.html`;
    items.push({
      vendor, page,
      url: j.url || j.link || '',
      timestamp: when,
      snippet: (j.snippet || j.diff || j.note || j.changed || '').toString().slice(0,300),
      local_path: localPath
    });
  } catch { /* ignore bad files */ }
}

const index = { generated_at: new Date().toISOString(), items };
await fs.writeFile(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));
console.log(`reports index items ${items.length}`);
