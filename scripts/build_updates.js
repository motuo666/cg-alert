// scripts/build_updates.js
// Build /updates (HTML + RSS) from evidence/**/YYYY-MM-DD.json
// - Real items = evidence/<vendor>/<date>.json (object or array)
// - Demo fallback: when real items within window == 0,
//   load evidence/_seed/*.json (array or object). If no seed files, use built-in demo.
// Env:
//   WINDOW_DAYS=30 (default)
//   SITE_ORIGIN=https://www.cg-alert.com (for RSS links)
//   MAX_ITEMS=100

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVID_DIR = path.join(ROOT, 'evidence');
const OUT_DIR  = path.join(ROOT, 'updates');
const SITE     = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';

const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 30);
const MAX_ITEMS   = Number(process.env.MAX_ITEMS || 100);
const CATS = ['Pricing','ToS','DPA','Subprocessors','Status'];

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function ymd(d){ const t = new Date(d); const z = (n)=>String(n).padStart(2,'0'); return `${t.getUTCFullYear()}-${z(t.getUTCMonth()+1)}-${z(t.getUTCDate())}`; }
function toUTCDateString(d){ return new Date(d).toUTCString(); }
function cutoffTs(days){ return Date.now() - days*24*3600*1000; }

function escapeHtml(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function escapeXml(s){ return escapeHtml(s); }

function walkJsonFiles(dir){
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of ents){
    const p = path.join(dir, e.name);
    if (e.isDirectory()){
      out.push(...walkJsonFiles(p));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.json')){
      out.push(p);
    }
  }
  return out;
}

function coerceArray(x){
  if (!x) return [];
  if (Array.isArray(x)) return x;
  return [x];
}

function loadEvidenceFiles(baseDir, allowSeed = false){
  // allowSeed=false: ignore _seed/*
  const files = walkJsonFiles(baseDir).filter(fp => allowSeed ? true : !fp.includes(`${path.sep}_seed${path.sep}`));
  const items = [];
  for (const fp of files){
    try{
      const raw = fs.readFileSync(fp, 'utf8');
      const data = JSON.parse(raw);
      const arr = coerceArray(data);
      for (const it of arr){
        if (!it) continue;
        const vendor   = it.vendor || guessVendorFromPath(fp);
        const category = it.category || 'Pricing';
        const source   = it.source || '';
        const dateStr  = it.date || guessDateFromPath(fp);
        const ts = Date.parse(dateStr);
        if (!ts || Number.isNaN(ts)) continue; // skip invalid
        const summary  = it.summary || '';
        const hash     = it.hash || `${vendor}-${ymd(ts)}-${path.basename(fp, '.json')}`;
        const isDemo   = !!it.is_demo || fp.includes(`${path.sep}_seed${path.sep}`);
        items.push({ vendor, category, source, date: ymd(ts), ts, summary, hash, is_demo: isDemo });
      }
    }catch(e){
      // ignore broken file, but log minimal
      console.error(`evidence parse fail: ${fp} ${e.message||e}`);
    }
  }
  return items;
}

function guessVendorFromPath(fp){
  const parts = fp.split(path.sep);
  const i = parts.indexOf('evidence');
  if (i >= 0 && i+1 < parts.length) return parts[i+1];
  return 'unknown';
}
function guessDateFromPath(fp){
  const m = /(\d{4}-\d{2}-\d{2})\.json$/i.exec(fp);
  return m ? m[1] : new Date().toISOString().slice(0,10);
}

function hostOf(url){
  try{ return new URL(url).hostname; }catch{ return ''; }
}

function countByCategory(items){
  const m = Object.fromEntries(CATS.map(c=>[c,0]));
  for (const it of items){
    const c = CATS.includes(it.category) ? it.category : 'Pricing';
    m[c] = (m[c]||0) + 1;
  }
  return m;
}

function htmlTemplate({ windowDays, items, counts, demoFlag }){
  const total = items.length;
  const chip = (name, n)=> `<span class="chip">${escapeHtml(name)} <b>${n}</b></span>`;
  const chips = CATS.map(c=>chip(c, counts[c]||0)).join(' ');
  const headNote = demoFlag
    ? `<div class="note">Sample evidence only — real highlights appear automatically once detected.</div>`
    : '';

  const cards = items.map((it,i) => {
    const href = it.source || `${SITE}/updates/`;
    const domain = hostOf(it.source) || '';
    const badge = it.is_demo ? `<span class="badge">DEMO</span>` : '';
    return `
    <article id="${escapeHtml(`${it.vendor}-${it.date}-${i}`)}" class="card">
      <header>
        <h3>${escapeHtml(it.category)} ${badge}</h3>
        <div class="sub">
          <span class="vendor">${escapeHtml(it.vendor)}</span>
          <span class="dot">·</span>
          <time>${escapeHtml(it.date)}</time>
          ${domain ? `<span class="dot">·</span><span class="domain">${escapeHtml(domain)}</span>` : ''}
        </div>
      </header>
      <p class="summary">${escapeHtml(it.summary)}</p>
      ${it.source ? `<a class="link" href="${escapeHtml(href)}" target="_blank" rel="noopener">Open source page</a>` : ''}
    </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Top Public Changes — CG Alert</title>
<style>
  :root { --fg:#111; --muted:#666; --line:#eee; --chip:#f5f5f5; --badge:#fbe8a6; --accent:#0d6efd; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif; color:var(--fg); margin:0; }
  header.top { display:flex; gap:.75rem; align-items:center; padding:16px 20px; border-bottom:1px solid var(--line); }
  header.top a { color: var(--accent); text-decoration:none; }
  main { max-width: 860px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 22px; margin: 0 0 6px 0; }
  .meta { color: var(--muted); margin-bottom: 10px; }
  .chips { margin: 12px 0 18px 0; display:flex; flex-wrap:wrap; gap:8px; }
  .chip { background: var(--chip); border:1px solid var(--line); border-radius: 999px; padding: 4px 10px; font-size: 12px; color:#333; }
  .note { background: #fffbe6; border:1px solid #ffe58f; padding:10px 12px; border-radius:8px; color:#8b6d00; margin: 8px 0 16px 0; font-size: 13px; }
  .list { display:grid; gap:12px; }
  .card { border: 1px solid var(--line); border-radius: 14px; padding: 14px 14px; background:#fff; }
  .card h3 { margin: 0 0 6px 0; font-size: 16px; }
  .sub { color: var(--muted); font-size: 13px; }
  .dot { margin: 0 6px; color:#bbb; }
  .summary { margin: 8px 0 10px 0; }
  .link { font-size: 13px; color: var(--accent); text-decoration:none; }
  .badge { display:inline-block; margin-left:8px; font-size:11px; background: var(--badge); border:1px solid #f2d27c; color:#7a5d00; padding:2px 6px; border-radius:999px; vertical-align:middle; }
  footer { color: var(--muted); font-size: 12px; border-top:1px solid var(--line); margin-top:16px; padding:12px 0 30px; }
</style>
<header class="top">
  <a href="/">← Home</a>
  <h1>Top Public Changes</h1>
</header>
<main>
  <div class="meta">Window: last ${windowDays} days · Items: ${total}</div>
  <div class="chips">${chips}</div>
  ${headNote}
  ${total ? `<section class="list">${cards}</section>` : `<p>No changes in the last ${windowDays} days.</p>`}
  <footer>
    We only collect public pages and respect robots.txt. Refund in 30 days if no material alert.
  </footer>
</main>
</html>`;
}

function rssXml(items){
  const channelTitle = 'CG Alert — Top Public Changes';
  const lastBuild = new Date().toUTCString();
  const xmlItems = items.map((it,i)=>{
    const title = `${it.vendor} — ${it.date}` + (it.is_demo ? ' [Demo]' : '');
    const link  = it.source || `${SITE}/updates/`;
    const guid  = `${SITE}/updates/#${encodeURIComponent(it.vendor)}-${it.date}-${i}`;
    const pub   = toUTCDateString(it.ts || Date.now());
    const desc  = it.summary || `${it.category} changed`;
    return `<item>
<title>${escapeXml(title)}</title>
<link>${escapeXml(link)}</link>
<guid isPermaLink="false">${escapeXml(guid)}</guid>
<pubDate>${escapeXml(pub)}</pubDate>
<description><![CDATA[${desc}]]></description>
</item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${escapeXml(channelTitle)}</title>
<link>${escapeXml(`${SITE}/updates/`)}</link>
<description>Top ${items.length} changes in the last ${WINDOW_DAYS} days (public pages: Pricing/ToS/DPA/Subprocessors/Status).</description>
<lastBuildDate>${escapeXml(lastBuild)}</lastBuildDate>
${xmlItems}
</channel>
</rss>`;
}

function pickAndFilter(items, windowDays, excludeDemo = false){
  const cutoff = cutoffTs(windowDays);
  let filtered = items.filter(it => it.ts >= cutoff);
  if (excludeDemo) filtered = filtered.filter(it => !it.is_demo);
  filtered.sort((a,b)=> (b.ts - a.ts) || String(a.vendor).localeCompare(b.vendor) );
  if (filtered.length > MAX_ITEMS) filtered = filtered.slice(0, MAX_ITEMS);
  return filtered;
}

function loadSeedsFromDir(){
  const seedDir = path.join(EVID_DIR, '_seed');
  const arr = [];
  if (!fs.existsSync(seedDir)) return arr;
  const seedFiles = walkJsonFiles(seedDir);
  for (const fp of seedFiles){
    try{
      const data = JSON.parse(fs.readFileSync(fp,'utf8'));
      for (const it of coerceArray(data)){
        if (!it) continue;
        const ts = Date.parse(it.date || new Date());
        arr.push({
          vendor: it.vendor || 'demo',
          category: it.category || 'Pricing',
          source: it.source || 'https://example.com/pricing',
          date: ymd(ts), ts,
          summary: it.summary || 'Sample update (Demo)',
          hash: it.hash || `seed-${path.basename(fp, '.json')}`,
          is_demo: true
        });
      }
    }catch(e){ console.error(`seed parse fail: ${fp} ${e.message||e}`); }
  }
  return arr;
}

function builtinDemoSeeds(){
  const today = new Date();
  const days = [2,5,9]; // spread a bit
  const cats = ['Pricing','ToS','Subprocessors'];
  const vendors = ['acme','contoso','globex'];
  return days.map((d,i)=>{
    const t = new Date(today.getTime() - d*24*3600*1000);
    return {
      vendor: vendors[i],
      category: cats[i],
      source: 'https://example.com/',
      date: ymd(t), ts: t.getTime(),
      summary: [
        'Updated pricing: Pro $49 → $59 (Demo)',
        'Terms updated: arbitration clause clarified (Demo)',
        'New subprocessor added: Example Cloud (Demo)'
      ][i],
      hash: `builtin-seed-${i}`,
      is_demo: true
    };
  });
}

// ---------------- main ----------------
(function main(){
  ensureDir(OUT_DIR);

  // 1) load real evidence (exclude _seed)
  const all = loadEvidenceFiles(EVID_DIR, /*allowSeed*/ false);
  const real = pickAndFilter(all, WINDOW_DAYS, /*excludeDemo*/ true);

  let items = real;
  let demoFlag = false;

  // 2) fallback to seeds when empty
  if (items.length === 0){
    let seeds = loadSeedsFromDir();
    if (!seeds.length) seeds = builtinDemoSeeds();
    // For demo, window filter也走，但基本会通过
    items = pickAndFilter(seeds, WINDOW_DAYS, /*excludeDemo*/ false);
    demoFlag = true;
  }

  // 3) counts
  const counts = countByCategory(items);

  // 4) write HTML
  const html = htmlTemplate({ windowDays: WINDOW_DAYS, items, counts, demoFlag });
  fs.writeFileSync(path.join(OUT_DIR,'index.html'), html, 'utf8');

  // 5) write RSS
  const rss = rssXml(items);
  fs.writeFileSync(path.join(OUT_DIR,'rss.xml'), rss, 'utf8');

  // 6) log
  console.log(`updates: built ${items.length} items (${WINDOW_DAYS}d) ${demoFlag ? '[demo]' : ''}`);
})();
