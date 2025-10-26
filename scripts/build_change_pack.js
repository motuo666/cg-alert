#!/usr/bin/env node

// CG Alert vendor change-pack page builder (finalized version)
// - CommonJS (compatible with Node 20 in Actions without "type": "module")
// - Unifies header / footer / CTA with main site
// - Removes "No summary." embarrassment
// - Falls back to an auto-generated summary if you didn't manually write What / So What / Now What
// - Adds CTA block to drive intake / purchase
// - Keeps hash / commit evidence for credibility

const fs = require('fs');
const path = require('path');

const REPORTS_DIR  = path.join(process.cwd(), 'reports');
const EVIDENCE_DIR = path.join(process.cwd(), 'evidence');

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function esc(s){
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// Extract narrative sections from an existing vendor page (if any).
// We try to preserve any human-written analysis from a previous run.
function extractNarrative(html) {
  function between(a,b){
    const re=new RegExp(a+'([\\s\\S]*?)'+b,'i');
    const m=html.match(re);
    return m?m[1].trim():'';
  }
  return {
    what:    between('<h3>\\s*What\\s*</h3>',        '<h3>\\s*So\\s*What\\s*</h3>'),
    soWhat:  between('<h3>\\s*So\\s*What\\s*</h3>',  '<h3>\\s*Now\\s*What\\s*</h3>'),
    nowWhat: between('<h3>\\s*Now\\s*What\\s*</h3>', '<h3>\\s*Verifiable\\s*evidence\\s*</h3>')
  };
}

// Collect evidence rows for a vendor in a given YYYY-MM folder.
function collectEvidence(vendor, month){
  const dir = path.join(EVIDENCE_DIR, vendor);
  const rows=[];
  if(fs.existsSync(dir)){
    for(const f of fs.readdirSync(dir)){
      if(!f.endsWith('.json')) continue;
      if(!f.startsWith(month+'-')) continue; // only evidence in that month (YYYY-MM)

      let data;
      try { data = JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); }
      catch { continue; }

      // filename sample:
      //   2025-10-13-DPA-76e76fef-00000000.json
      // parts: [YYYY,MM,DD,Type,...restSignatureBits]
      const base = f.replace(/\.json$/,'');
      const parts = base.split('-');
      const dateStr = parts.slice(0,3).join('-');     // 2025-10-13
      const typeStr = parts.slice(3).join('-');       // DPA-76e76fef-00000000

      const shaFull = data.sha256 || data.hash || '';
      const hashShort = shaFull.slice(0,8);

      rows.push({
        when: dateStr,
        typ: typeStr,
        hashShort,
        hrefBase: base,
        excerpt: '' // you could later insert diff snippet, headline, etc.
      });
    }
  }

  // newest first
  rows.sort((a,b)=>{
    if(a.when < b.when) return 1;
    if(a.when > b.when) return -1;
    return a.typ.localeCompare(b.typ);
  });

  const lastChange     = rows[0]?.when || '';
  const evidenceCount  = rows.length;
  let verifiedHash = '';
  let commitId     = '';

  if(rows.length){
    const firstJson = rows[0].hrefBase + '.json';
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR,vendor,firstJson),'utf8'));
      const hfull    = obj.sha256 || obj.hash || '';
      verifiedHash   = hfull.slice(0,8);
      commitId       = obj.commit || '';
    } catch(_) {}
  }

  return { rows, lastChange, evidenceCount, verifiedHash, commitId };
}

function impactFromCount(n){
  if(n>=20) return 'High';
  if(n>=6)  return 'Medium';
  return 'Low';
}

// If user didn't actually give "What / So What / Now What", we auto-generate
// a fallback one-liner so the page doesn't look empty / amateur.
function buildFallbackSummary(vendor, month, evInfo){
  const imp = impactFromCount(evInfo.evidenceCount);
  const last = evInfo.lastChange || month;
  return (
    `<p>We observed public changes for <strong>${esc(vendor)}</strong> in <strong>${esc(month)}</strong> (latest: ${esc(last)}). ` +
    `Impact score: ${esc(imp)}. Evidence below includes timestamp, source URL, and cryptographic hash so Procurement / Legal Ops / Finance can prove it at renewal. ` +
    `Not legal advice.</p>`
  );
}

// Build narrative block HTML (What / So What / Now What) or fallback card.
function buildNarrativeCards(vendor, month, nar, evInfo){
  const hasAny =
    (nar.what && nar.what.trim()) ||
    (nar.soWhat && nar.soWhat.trim()) ||
    (nar.nowWhat && nar.nowWhat.trim());

  if (!hasAny) {
    // single fallback card
    return `
    <div class="card">
      <h2 class="h1">Summary</h2>
      ${buildFallbackSummary(vendor, month, evInfo)}
    </div>`;
  }

  // Render only non-empty sections. No "No summary." junk.
  const parts = [];
  if (nar.what && nar.what.trim()) {
    parts.push(`
      <div class="card">
        <h2 class="h1">What</h2>
        ${nar.what}
      </div>`);
  }
  if (nar.soWhat && nar.soWhat.trim()) {
    parts.push(`
      <div class="card">
        <h2 class="h1">So What</h2>
        ${nar.soWhat}
      </div>`);
  }
  if (nar.nowWhat && nar.nowWhat.trim()) {
    parts.push(`
      <div class="card">
        <h2 class="h1">Now What</h2>
        ${nar.nowWhat}
      </div>`);
  }

  // If somehow everything was empty after trim, still fall back.
  if (!parts.length) {
    return `
    <div class="card">
      <h2 class="h1">Summary</h2>
      ${buildFallbackSummary(vendor, month, evInfo)}
    </div>`;
  }

  return parts.join('\n');
}

// CTA block we reuse everywhere (same tone as /pricing /dpa /status pages)
function buildCTASection(){
  return `
  <section class="cta-block" style="margin-top:24px;padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--card);box-shadow:var(--shadow)">
    <h2 style="margin:0 0 8px;font-size:16px;font-weight:600;color:var(--ink)">Want this mapped to <em>your</em> vendor list?</h2>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:var(--muted)">
      We watch pricing / ToS/MSA / DPA / subprocessors / status pages.
      You get timestamped, hash-backed change packs aligned to renewal windows.
      Procurement and Legal Ops get leverage before the call, not after.
    </p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      <a class="btn primary" href="/intake" style="display:inline-block;padding:8px 12px;border-radius:8px;background:#111;color:#fff;border:1px solid #111;text-decoration:none">Enable alerts</a>
      <a class="btn ghost" href="/buy/portfolio" style="display:inline-block;padding:8px 12px;border-radius:8px;border:1px solid #111;text-decoration:none;color:#111;background:transparent">Buy Portfolio · $2,988/yr</a>
    </div>
  </section>`;
}

// -----------------------------------------------------------------------------
// Page renderer
// -----------------------------------------------------------------------------

function renderVendorPage(vendor, month, nar, ev){
  // unified nav / header same as new site pages
  const HEADER = `
<header class="app-header">
  <div class="nav container">
    <a class="logo" href="/"><img src="/icon.svg" alt="CG Alert" />CG Alert</a>
    <a href="/reports/">Reports</a>
    <a href="/who-uses/">Who Uses</a>
    <a href="/pricing/">Pricing</a>
    <a href="/terms">Terms</a>
    <a href="/privacy">Privacy</a>
    <a href="/rss" rel="nofollow">RSS</a>
  </div>
</header>`.trim();

  // little stat pills under H1
  const chips = [
    ev.lastChange && `Last change: ${esc(ev.lastChange)}`,
    `Evidence: ${esc(ev.evidenceCount)}`,
    `Impact: ${esc(impactFromCount(ev.evidenceCount))}`,
    ev.verifiedHash && `Verified • #${esc(ev.verifiedHash)}${ev.commitId?` • ${esc(ev.commitId)}`:''}`
  ].filter(Boolean);

  // evidence table rows
  const tableRowsHtml = ev.rows.map(r => {
    // evidence card HTML (NOT the raw JSON)
    const evHref = `/evidence/${encodeURIComponent(vendor)}/${r.hrefBase}.html`;
    return `<tr>
      <td>${esc(r.when)}</td>
      <td>${esc(r.typ)}</td>
      <td><code>#${esc(r.hashShort)}</code></td>
      <td><a class="link" href="${evHref}" rel="nofollow">evidence</a></td>
      <td>${esc(r.excerpt)}</td>
    </tr>`;
  }).join('');

  // narrative cards (or fallback summary card)
  const narrativeHtml = buildNarrativeCards(vendor, month, nar, ev);

  // CTA block
  const CTA_HTML = buildCTASection();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(vendor)} — Change Pack (${esc(month)}) · CG Alert</title>
<meta name="description" content="Evidence-backed public changes for ${esc(vendor)} in ${esc(month)}. Timestamped, hashed, commit-referenced. For Procurement / Legal Ops / Finance. Not legal advice.">
<link rel="canonical" href="/reports/${esc(month)}/${esc(vendor)}/">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0b0d12">

<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">

<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/assets/cg-theme.css">

<style>
/* page-specific tightening: consistent with cg-theme.css tone */
.kv{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  margin:.75rem 0 1.25rem;
}
.kv span{
  display:inline-block;
  background:var(--card);
  border:1px solid var(--border);
  border-radius:999px;
  padding:.3rem .6rem;
  font-size:12px;
  color:var(--muted);
  line-height:1.4;
}
.card + .card{margin-top:16px;}
.card h2.h1{
  font-size:16px;
  margin:0 0 8px 0;
  font-weight:600;
  color:var(--ink);
}
.table-changes{
  width:100%;
  border-collapse:collapse;
  font-size:14px;
  line-height:1.5;
}
.table-changes thead th{
  background:var(--card);
  text-align:left;
  padding:8px;
  border-bottom:1px solid var(--border);
  font-weight:500;
  font-size:12px;
  text-transform:uppercase;
  letter-spacing:.03em;
  color:var(--muted);
}
.table-changes td{
  padding:8px;
  border-bottom:1px solid var(--border);
  vertical-align:top;
}
code{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:4px;
  padding:2px 4px;
  font-size:12px;
}
.small{
  color:var(--muted);
  font-size:12px;
  line-height:1.4;
  margin-top:8px;
}
.btn-row{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
}
footer.container{
  margin-top:32px;
  padding:24px 16px;
  font-size:13px;
  color:var(--muted);
  text-align:center;
}
</style>

<meta property="og:title" content="${esc(vendor)} — Change Pack (${esc(month)}) · CG Alert">
<meta property="og:description" content="Evidence-backed public changes for ${esc(vendor)} in ${esc(month)}. Timestamped, hashed, commit-referenced.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://www.cg-alert.com/reports/${esc(month)}/${esc(vendor)}/">
</head>
<body>

${HEADER}

<main class="main container" id="main">
  <div class="section"><div class="container" style="max-width:720px;margin:0 auto;padding:24px 16px">

    <h1 class="h1" style="margin:0 0 12px;">${esc(vendor)} — Change Pack (${esc(month)})</h1>

    <div class="kv">
      ${chips.map(t=>`<span>${t}</span>`).join('')}
    </div>

    ${narrativeHtml}

    <div class="card" style="margin-top:24px;">
      <h2 class="h1" style="margin-bottom:12px;">Verifiable Evidence</h2>
      <table class="table-changes">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Hash</th>
            <th>Link</th>
            <th>Excerpt</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
      <p class="small">
        Public-source only (Pricing, ToS/MSA, DPA, Subprocessors, Status, etc.).
        We capture timestamp, source URL, and cryptographic hash so Procurement / Legal Ops / Finance can prove it at renewal.
        Not legal advice.
      </p>
    </div>

    ${CTA_HTML}

    <div class="card" style="margin-top:24px;">
      <div class="btn-row">
        <a class="btn" href="/">Home</a>
        <a class="btn ghost" href="/reports/">All Reports</a>
        <a class="btn ghost" href="/rss" rel="nofollow">RSS</a>
      </div>
    </div>

  </div></div>
</main>

<footer class="container">
  © CG Alert — Evidence-backed vendor change alerts.
</footer>

</body>
</html>`;
}

// -----------------------------------------------------------------------------
// Main rebuild
// -----------------------------------------------------------------------------

function rebuild() {
  if(!fs.existsSync(REPORTS_DIR)) return;

  for(const month of fs.readdirSync(REPORTS_DIR)){
    if(!/^\d{4}-\d{2}$/.test(month)) continue;
    const monthDir = path.join(REPORTS_DIR, month);
    if(!fs.statSync(monthDir).isDirectory()) continue;

    for(const vendor of fs.readdirSync(monthDir)){
      const vendorDir = path.join(monthDir, vendor);
      if(!fs.statSync(vendorDir).isDirectory()) continue;

      const idxPath = path.join(vendorDir,'index.html');
      const oldHtml = fs.existsSync(idxPath)
        ? fs.readFileSync(idxPath,'utf8')
        : '';

      const nar = extractNarrative(oldHtml);
      const ev  = collectEvidence(vendor, month);

      const html = renderVendorPage(vendor, month, nar, ev);
      fs.writeFileSync(idxPath, html, 'utf8');
      console.log('rebuilt vendor page:', idxPath);
    }
  }
}

rebuild();
