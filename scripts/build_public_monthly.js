#!/usr/bin/env node
/**
 * build_public_monthly.js — generate /reports/<YYYY-MM>/, /reports/index.html, /reports/rss.xml
 * Evidence source: evidence/<vendor>/<YYYY-MM-DD>.json (mtime used as last change time)
 * Idempotent. No external deps.
 */
const fs = require('fs'); const path = require('path');
const SITE = 'https://www.cg-alert.com'; const ROOT = path.join(__dirname, '..');
function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function ymOf(ts){ return ts.toISOString().slice(0,7); }
function ymd(ts){ return ts.toISOString().slice(0,10); }
function listEvidence(){ const base = path.join(ROOT, 'evidence'); const out=[];
  if (!fs.existsSync(base)) return out;
  for (const vd of fs.readdirSync(base,{withFileTypes:true})) { if (!vd.isDirectory()) continue;
    const slug = vd.name, dir = path.join(base, slug);
    for (const f of fs.readdirSync(dir)) { if (!/\.json$/i.test(f)) continue;
      const p = path.join(dir, f); const st = fs.statSync(p);
      out.push({ slug, mtime: st.mtime });
    }
  } return out.sort((a,b)=>b.mtime-a.mtime);
}
function groupByMonth(items){ const m = new Map(); for(const it of items){ const k=ymOf(it.mtime); if(!m.has(k)) m.set(k, []); m.get(k).push(it);} return m; }
function htmlEscape(s){return String(s).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));}
function renderMonthHTML(ym, items){ const byVendor={};
  for(const it of items){ const k=it.slug; if(!byVendor[k]) byVendor[k]={slug:k, latest:it.mtime}; if(it.mtime>byVendor[k].latest) byVendor[k].latest=it.mtime; }
  const rows = Object.values(byVendor).sort((a,b)=>b.latest-a.latest).map(g=>`<tr>
    <td><a href="/vendors/${encodeURIComponent(g.slug)}/">${htmlEscape(g.slug)}</a></td>
    <td>${ymd(g.latest)}</td>
  </tr>`).join('\n') || '<tr><td colspan="2">No changes this month.</td></tr>';
  const title = `Public Changes — ${ym} · CG Alert`, canon = `${SITE}/reports/${ym}/`, desc = `Evidence-backed public changes in ${ym}.`;
  const ld = {"@context":"https://schema.org","@type":"Report","name":title,"datePublished":`${ym}-01`,"url":canon,"publisher":{"@type":"Organization","name":"CG Alert","url":SITE}};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${desc}"><link rel="canonical" href="${canon}">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;color:#111}.wrap{max-width:980px;margin:0 auto;padding:28px 16px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #eee;text-align:left}</style>
</head><body><div class="wrap"><h1>Public Changes — ${ym}</h1><table><thead><tr><th>Vendor</th><th>Last Update</th></tr></thead><tbody>${rows}</tbody></table></div></body></html>`;
}
function renderIndexHTML(latestYM, months){ const links = months.map(m=>`<li><a href="/reports/${m}/">${m}</a></li>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reports — CG Alert</title><meta name="description" content="Monthly evidence-backed public changes."><link rel="canonical" href="${SITE}/reports/"><link rel="alternate" type="application/rss+xml" href="${SITE}/reports/rss.xml"></head>
<body><div class="wrap" style="max-width:720px;margin:0 auto;padding:28px 16px"><h1>Reports</h1><p>Latest: <a href="/reports/${latestYM}/">${latestYM}</a></p><ul>${links}</ul></div></body></html>`;
}
function renderRSS(months){ const now = new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>CG Alert — Monthly Reports</title><link>${SITE}/reports/</link><description>Evidence-backed changes</description><lastBuildDate>${now}</lastBuildDate>
${months.slice(0,12).map(ym=>`<item><title>${ym}</title><link>${SITE}/reports/${ym}/</link><guid>${SITE}/reports/${ym}/</guid><pubDate>${new Date(ym+'-01').toUTCString()}</pubDate></item>`).join('\n')}
</channel></rss>`;
}
(function main(){
  const ROOT = path.join(__dirname, '..'); const outBase = path.join(ROOT, 'reports');
  const all = listEvidence(); const buckets = groupByMonth(all); const months = [...buckets.keys()].sort().reverse();
  const targetYM = (process.argv.find(a=>a.startsWith('--month='))||'').split('=')[1] || (months[0] || new Date().toISOString().slice(0,7));
  const items = buckets.get(targetYM) || []; const dir = path.join(outBase, targetYM); ensureDir(dir);
  fs.writeFileSync(path.join(dir,'index.html'), renderMonthHTML(targetYM, items));
  const list = months.length ? months : [targetYM]; ensureDir(outBase);
  fs.writeFileSync(path.join(outBase,'index.html'), renderIndexHTML(targetYM, list));
  fs.writeFileSync(path.join(outBase,'rss.xml'), renderRSS(list));
  console.log(`[reports] built for ${targetYM} (months=${list.length})`);
})();
