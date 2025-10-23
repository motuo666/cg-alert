// scripts/import_buildwith.js
// 读取 data/*.csv|json 批量导入到 Worker /import；每批 500，带 x-obs-key 认证
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const WORKER_URL = process.env.WORKER_URL;         // e.g. https://lead-gateway.xxx.workers.dev
const OBS_KEY    = process.env.OBS_KEY;            // 与 /stats 同一把
if (!WORKER_URL || !OBS_KEY) {
  console.error('Missing WORKER_URL or OBS_KEY'); process.exit(1);
}

function listDataFiles() {
  const dir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => /\.(csv|json)$/i.test(f));
  return files.map(f => path.join(dir, f));
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const head = lines.shift().split(',').map(s=>s.trim().toLowerCase());
  const idx = k => head.indexOf(k);
  const out = [];
  for (const ln of lines) {
    const cols = ln.split(',');
    const email = (cols[idx('email')]||'').trim().toLowerCase();
    const domain = (cols[idx('domain')]||'').trim().toLowerCase();
    const company= (cols[idx('company')]||'').trim();
    const tech = (cols[idx('tech')]||'').split(/;|,/).map(s=>s.trim()).filter(Boolean);
    if (email) out.push({ email, domain, company, tech });
  }
  return out;
}

async function importBatch(items) {
  const isCSV = false;
  const res = await fetch(`${WORKER_URL}/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-obs-key': OBS_KEY },
    body: JSON.stringify(items)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`IMPORT_FAIL ${res.status}: ${t}`);
  }
  return res.json();
}

(async ()=>{
  const files = listDataFiles();
  if (!files.length) { console.log('No data files.'); return; }
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf-8');
    let items = [];
    if (f.endsWith('.json')) {
      const j = JSON.parse(raw);
      items = Array.isArray(j)? j : (j.items || []);
    } else {
      items = parseCSV(raw);
    }
    console.log(`File ${path.basename(f)} -> ${items.length} rows`);
    // chunk 500
    for (let i=0;i<items.length;i+=500) {
      const chunk = items.slice(i,i+500);
      const r = await importBatch(chunk);
      console.log(`  imported:${r.imported} skipped:${r.skipped}`);
    }
  }
  console.log('Import done.');
})().catch(e=>{ console.error(e); process.exit(1); });
