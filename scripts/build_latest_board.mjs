// Build a static board page showing latest N evidence cards
// and a simple quality summary for the last D days.
//
// This script is deliberately self-contained and defensive:
// - It prefers reports/feed.json, but can fall back to a flat array.
// - Evidence stats are computed from evidence/*.json sampled by captured_at / timestamp / filename.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'reports');
const EVIDENCE_DIR = path.join(ROOT, 'evidence');
const OUT_DIR = REPORTS_DIR;
const N = Number(process.env.LATEST_N || '12');
const DAYS = Number(process.env.LATEST_STATS_DAYS || '30');

function loadItems() {
  const feedPath = path.join(REPORTS_DIR, 'feed.json');
  if (fs.existsSync(feedPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(feedPath, 'utf-8'));
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.items)) return data.items;
    } catch (e) {
      console.warn('[latest-board] failed to parse feed.json:', e.message);
    }
  }
  return [];
}

function safeParseDate(input, fallback) {
  if (!input && !fallback) return null;
  const candidate = input || fallback;
  if (!candidate || typeof candidate !== 'string') return null;
  const d = new Date(candidate);
  return isNaN(d.getTime()) ? null : d;
}

function loadQualityStats(days = DAYS) {
  const stats = {
    days,
    total: 0,
    areas: new Map(),
  };
  if (!fs.existsSync(EVIDENCE_DIR)) return stats;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(EVIDENCE_DIR).filter(f => f.endsWith('.json') && /^\d{4}-\d{2}-\d{2}T/.test(f));

  for (const file of files) {
    const full = path.join(EVIDENCE_DIR, file);
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(full, 'utf-8'));
    } catch {
      continue;
    }
    const ts = safeParseDate(obj.captured_at || obj.timestamp || obj.ts, file.slice(0, 24).replace('_', ':'));
    if (!ts || ts.getTime() < cutoff) continue;

    stats.total += 1;
    const areaRaw = (obj.area || 'Other').toString();
    const area = areaRaw.trim() || 'Other';
    stats.areas.set(area, (stats.areas.get(area) || 0) + 1);
  }

  return stats;
}

function renderStats(stats) {
  const entries = Array.from(stats.areas.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const chips = entries.map(([area, count]) =>
    `<li><span class="chip-area">${area}</span><span class="chip-count">${count}</span></li>`
  ).join('');

  const totalLabel = stats.total
    ? `Last ${stats.days} days: <strong>${stats.total}</strong> confirmed changes`
    : `Last ${stats.days} days: no confirmed changes yet`;

  return `<section class="cg-wrap cg-quality">
  <header class="quality-head">
    <h1>Latest evidence</h1>
    <p class="cg-muted cg-small">${totalLabel} across monitored vendors.</p>
  </header>
  <ul class="quality-areas">${chips}</ul>
</section>`;
}

function pageHTML(items, stats) {
  const cards = (items || [])
    .slice(0, N)
    .map(it => {
      const vendor = (it.vendor || 'Vendor').toString();
      const url = (it.url || '#').toString();
      const date = (it.date || it.captured_at || '').toString();
      const summary = (it.summary || '').toString();
      return `<article class="evidence-card">
  <h4><a href="${url}">${vendor}</a></h4>
  <time>${date}</time>
  <p>${summary}</p>
</article>`;
    }).join('');

  const statsBlock = renderStats(stats);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Latest evidence — CG Alert</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<link rel="canonical" href="https://www.cg-alert.com/reports/latest.html" />
<link rel="stylesheet" href="/assets/home-v3c.css" />
<meta name="description" content="Browse the latest vendor change evidence captured by CG Alert, with a quick summary of recent material changes." />
</head>
<body>
<header class="cg-topbar">
  <div class="cg-wrap cg-nav">
    <a class="cg-brand" href="/"><img src="/icon.svg" alt="CG Alert" width="40" height="40" /><span>CG&nbsp;Alert</span></a>
    <nav class="nav">
      <a href="/">Home</a>
      <a href="/pricing/">Pricing</a>
      <a href="/reports/">Reports</a>
      <a href="/stories/">Insights</a>
      <a href="/rss/">RSS</a>
      <a href="/who-uses/">Who Uses</a>
      <a href="/faq/">FAQ</a>
    </nav>
  </div>
</header>

${statsBlock}

<main class="cg-wrap">
  <section class="cards-grid">
    ${cards || '<p class="cg-muted cg-small">No recent evidence yet.</p>'}
  </section>
</main>

<style>
.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin:18px 0;}
.evidence-card{border:1px solid #e5e5e5;border-radius:10px;padding:12px;background:#fff}
.evidence-card h4{margin:0 0 6px;font-size:16px;line-height:1.25}
.evidence-card time{display:block;color:#777;font-size:12px;margin-bottom:6px}
.evidence-card p{margin:0;color:#444;font-size:13px;line-height:1.4}

.cg-quality{margin-top:24px;margin-bottom:8px;display:flex;flex-direction:column;gap:8px;}
.quality-head h1{margin:0 0 4px;font-size:22px;}
.quality-head p{margin:0;}
.quality-areas{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-wrap:wrap;gap:8px;}
.quality-areas li{display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:999px;background:#f5f5f7;border:1px solid #e0e0e4;font-size:12px;}
.chip-area{font-weight:500;}
.chip-count{color:#555;}
</style>
</body>
</html>`;
}

function main() {
  const items = loadItems();
  const stats = loadQualityStats();
  const html = pageHTML(items, stats);
  const out = path.join(OUT_DIR, 'latest.html');
  fs.writeFileSync(out, html);
  console.log('[latest-board] wrote', out);
}

main();
