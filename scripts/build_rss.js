#!/usr/bin/env node
// Build RSS from /evidence into /rss.xml (root). CommonJS for Actions Node 20.
const fs = require('fs');
const path = require('path');

const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'evidence');
const OUT_FILE = path.join(ROOT, 'rss.xml');

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(d){ try{ return new Date(d).toUTCString(); } catch{ return new Date().toUTCString(); } }

function* iterateEvidence(){
  if (!fs.existsSync(SRC_DIR)) return;
  for (const vendor of fs.readdirSync(SRC_DIR)) {
    const vdir = path.join(SRC_DIR, vendor);
    if (!fs.statSync(vdir).isDirectory()) continue;
    for (const cap of fs.readdirSync(vdir)) {
      const idx = path.join(vdir, cap, 'index0.html');
      const meta = path.join(vdir, cap, 'meta.json');
      if (fs.existsSync(idx)) {
        let detectedAt = cap;
        let typ = 'change';
        let impact = 'TBD';
        if (fs.existsSync(meta)) {
          try {
            const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
            detectedAt = m.detected_at || m.ts || detectedAt;
            typ = m.type || m.kind || typ;
            impact = m.impact || impact;
          } catch {}
        }
        yield { vendor, cap, detectedAt, typ, impact };
      }
    }
  }
}

const items = [];
for (const it of iterateEvidence()) {
  const dt = fmtDate(it.detectedAt);
  const title = `${it.vendor} ${it.typ} (${it.cap})`;
  const link = `${ORIGIN}/evidence/${encodeURIComponent(it.vendor)}/${encodeURIComponent(it.cap)}/index0.html`;
  const desc = esc(`${it.vendor} ${it.typ} captured at ${it.cap}. Impact: ${it.impact}. Evidence includes timestamp, source URL, cryptographic hash.`);
  items.push(`<item><title>${esc(title)}</title><link>${link}</link><pubDate>${dt}</pubDate><description>${desc}</description></item>`);
}

// keep last 100
const last = items.slice(-100).join('\n');
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>CG Alert Feed</title>
<link>${ORIGIN}/</link>
<description>Latest vendor change evidence</description>
${last}
</channel></rss>`;
fs.writeFileSync(OUT_FILE, rss, 'utf8');
console.log(`[build_rss] wrote ${OUT_FILE} with ${items.length} items (showing ${Math.min(items.length,100)})`);
