import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { loadJSON, ensureDir, writeText } from './util.js';

const ROOT = process.cwd();
const daily = loadJSON(path.join(ROOT,'artifacts','daily_ops.json'), null);
const now = dayjs();

const k = daily?.kpi || {};
const md = `# Weekly Vendor Change Report

- Date: **${now.format('YYYY-MM-DD')}**
- Evidence today: **${k.evidence_today ?? 'n/a'}**
- Sent today: **${k.sent_today ?? 'n/a'}**
- Hash coverage: **${k.hash_ratio ? (k.hash_ratio*100).toFixed(1)+'%' : 'n/a'}**
- TTD: P50 **${k.ttd_p50_hours ?? 'n/a'}h**, P95 **${k.ttd_p95_hours ?? 'n/a'}h**, samples **${k.ttd_samples ?? '0'}**
- Changed vendors (72h): **${k.changed_vendors_72h ?? 'n/a'}**

_For more details, contact sales._
`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Weekly Vendor Change Report ${now.format('YYYY-[W]WW')}</title>
</head><body><pre>${md.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre></body></html>`;

const outDir = path.join(ROOT,'public','reports'); ensureDir(outDir);
const slug = now.format('YYYY-[W]WW');
writeText(path.join(outDir, `${slug}.md`), md);
writeText(path.join(outDir, `${slug}.html`), html);
console.log(`Weekly report → public/reports/${slug}.(md|html)`);
