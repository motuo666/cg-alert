#!/usr/bin/env node
/**
 * build_public_monthly.js
 * 读取 evidence/<vendor>/<YYYY-MM-DD>.json，生成：
 *   reports/YYYY-MM/index.html  （该月公开月报）
 *   reports/index.html          （指向最近一月）
 *   reports/rss.xml             （最近一月 RSS）
 *
 * 约定：证据 JSON 可以是数组或对象；字段尽可能兼容：
 *   { type, url, title, message|summary|snippet, ts|timestamp }
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVI_DIR = path.join(ROOT, 'evidence');
const OUT_DIR = path.join(ROOT, 'reports');

const SITE = 'https://www.cg-alert.com';
const TYPES = ['pricing','tos','dpa','subprocessors','status'];

function yymm(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  return `${y}-${m}`;
}

// 默认：生成“上一个自然月”的月报；允许通过 env 覆盖
const REPORT_MONTH = process.env.REPORT_MONTH || (() => {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-1, 1));
  return yymm(prev);
})();

function normalizeItem(vendor, dateISO, raw) {
  const o = raw || {};
  const type = String(o.type||'other').toLowerCase();
  const url  = o.url || '';
  const title = o.title || '';
  const snippet = o.message || o.summary || o.snippet || '';
  const ts = o.ts || o.timestamp || dateISO;
  return { vendor, date: dateISO.slice(0,10), type, url, title, snippet, ts };
}

function readEvidenceForMonth(yymmStr) {
  const out = [];
  if (!fs.existsSync(EVI_DIR)) return out;

  for (const vd of fs.readdirSync(EVI_DIR, { withFileTypes:true })) {
    if (!vd.isDirectory()) continue;
    const vendor = vd.name;
    if (!vendor || vendor==='acme' || vendor.startsWith('_')) continue;

    const vdir = path.join(EVI_DIR, vendor);
    for (const f of fs.readdirSync(vdir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/i.test(f)) continue;
      if (!f.startsWith(yymmStr)) continue; // 只取该月
      const fp = path.join(vdir, f);
      let raw;
      try { raw = JSON.parse(fs.readFileSync(fp,'utf8')); } catch { continue; }
      const dateISO = f.replace('.json','') + 'T00:00:00Z';
      const items = Array.isArray(raw) ? raw : [raw];
      for (const it of items) out.push(normalizeItem(vendor, dateISO, it));
    }
  }
  return out;
}

function htmlEscape(s=''){return String(s).replace(/[&<>"]/g,c=>({ '&':'&nbsp;&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]).replace('&nbsp;',''));}
function renderHTML(month, items) {
  const counts = {total:items.length}; for (const t of TYPES) counts[t]=0;
  for (const it of items) { if (TYPES.includes(it.type)) counts[it.type]++; }

  const byVendor = new Map();
  for (const it of items) {
    if (!byVendor.has(it.vendor)) byVendor.set(it.vendor, []);
    byVendor.get(it.vendor).push(it);
  }
  // 每 vendor 内按日期 desc
  for (const v of byVendor.values()) v.sort((a,b)=> (a.date<b.date?1:-1));

  const head = `
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Public Changes — ${month} — CG Alert</title>
<meta name="description" content="Evidence-backed public changes in ${month} (Pricing/ToS/DPA/Subprocessors/Status).">
<link rel="canonical" href="${SITE}/reports/${month}/">
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;color:#111;background:#fff}
  .wrap{max-width:980px;margin:0 auto;padding:32px 16px}
  h1{font-size:28px;margin:8px 0 8px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:14px 0 8px}
  .k{border:1px solid #eee;border-radius:12px;padding:10px}
  .vendor{margin:18px 0;padding:14px;border:1px solid #eee;border-radius:16px}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #ddd;font-size:12px;color:#333;margin-left:6px}
  .itm{margin:8px 0;padding:8px 10px;border:1px dashed #eee;border-radius:12px}
  .meta{color:#666;font-size:13px}
  a.btn{display:inline-block;margin-top:6px;padding:8px 12px;border:1px solid #111;border-radius:10px;text-decoration:none;color:#111}
  a.btn:hover{background:#111;color:#fff}
  footer{margin:28px 0 0;color:#666;font-size:13px}
</style>
<script type="application/ld+json">{
  "@context":"https://schema.org","@type":"CollectionPage",
  "name":"Public Changes — ${month}",
  "url":"${SITE}/reports/${month}/",
  "about":["Pricing","Terms of Service","DPA","Subprocessors","Status"],
  "inLanguage":"en",
  "publisher":{"@type":"Organization","name":"CG Alert","url":"${SITE}"}
}</script>
</head><body><div class="wrap">
<a href="/" aria-label="Home">← Home</a>
<h1>Public Changes — ${month}</h1>
<div class="kpis">
  <div class="k"><b>Total</b><div>${counts.total}</div></div>
  <div class="k"><b>Pricing</b><div>${counts.pricing}</div></div>
  <div class="k"><b>ToS</b><div>${counts.tos}</div></div>
  <div class="k"><b>DPA</b><div>${counts.dpa}</div></div>
  <div class="k"><b>Subprocessors</b><div>${counts.subprocessors}</div></div>
  <div class="k"><b>Status</b><div>${counts.status}</div></div>
</div>
<p class="meta">We only collect public pages and respect robots.txt. Refund in 30 days if no material alert.</p>
`;

  let body = '';
  const vendorSlugs = Array.from(byVendor.keys()).sort();
  for (const slug of vendorSlugs) {
    const list = byVendor.get(slug);
    const vendorUrl = `${SITE}/vendors/${encodeURIComponent(slug)}/`;
    body += `<div class="vendor"><h3>${htmlEscape(slug)} <a class="badge" href="${vendorUrl}">Vendor page</a></h3>\n`;
    for (const it of list) {
      const tag = TYPES.includes(it.type) ? it.type : 'other';
      const u = it.url ? `<a href="${it.url}" target="_blank" rel="nofollow noopener">source</a>` : '';
      const s = it.snippet ? htmlEscape(it.snippet) : (it.title ? htmlEscape(it.title) : '');
      body += `<div class="itm"><div class="meta">${it.date} · <b>${tag}</b></div>${s?`<div>${s}</div>`:''}${u?`<div>${u}</div>`:''}</div>\n`;
    }
    body += `</div>\n`;
  }

  const tail = `
<footer>© ${new Date().getUTCFullYear()} CG Alert</footer>
</div></body></html>`;
  return head + body + tail;
}

function renderRSS(month, items){
  const esc = s => String(s||'').replace(/[&<>]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const rssItems = items.slice(0,200).map(it=>{
    const guid = `${SITE}/updates/#${esc(it.vendor)}-${it.date}-rss`;
    const link = it.url || `${SITE}/vendors/${encodeURIComponent(it.vendor)}/`;
    const title = `${it.vendor} — ${it.type} — ${it.date}`;
    const desc = esc(it.snippet || it.title || '');
    return `<item><title>${esc(title)}</title><link>${esc(link)}</link><guid isPermaLink="false">${esc(guid)}</guid><pubDate>${new Date(it.ts||it.date).toUTCString()}</pubDate><description><![CDATA[${desc}]]></description></item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>CG Alert — Public Changes ${month}</title>
<link>${SITE}/reports/${month}/</link>
<description>Evidence-backed public changes in ${month}.</description>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${rssItems}
</channel></rss>`;
}

(function main(){
  const items = readEvidenceForMonth(REPORT_MONTH);
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const monthDir = path.join(OUT_DIR, REPORT_MONTH);
  if (!fs.existsSync(monthDir)) fs.mkdirSync(monthDir, { recursive: true });

  // 写该月页面
  fs.writeFileSync(path.join(monthDir,'index.html'), renderHTML(REPORT_MONTH, items), 'utf8');
  // 最新指针
  fs.writeFileSync(path.join(OUT_DIR,'index.html'), `<!doctype html><meta http-equiv="refresh" content="0; url=/reports/${REPORT_MONTH}/">`, 'utf8');
  // RSS（最近一月）
  fs.writeFileSync(path.join(OUT_DIR,'rss.xml'), renderRSS(REPORT_MONTH, items), 'utf8');

  console.log(`public monthly report built: reports/${REPORT_MONTH}/index.html, reports/index.html, reports/rss.xml`);
})();
