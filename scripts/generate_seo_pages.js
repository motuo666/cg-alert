/**
 * Programmatic SEO 落地页（稳健：无数据也不报错）
 * - 输入：artifacts/daily_ops.json（已有产物）
 * - 可选：data/vendors.json（数组：["Okta","Snowflake",...]）
 * - 输出：public/seo/**.html
 */
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { loadJSON, ensureDir, writeText, fmtDate, yyyymm } from './util.js';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'public', 'seo');
ensureDir(OUT);

const daily = loadJSON(path.join(ROOT, 'artifacts', 'daily_ops.json'), null);
const vendors = loadJSON(path.join(ROOT, 'data', 'vendors.json'), []); // 可选
const now = dayjs(); const ym = daily?.YM || yyyymm(now);
const k = daily?.kpi || {};

const layout = (title, desc, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${desc||''}">
<link rel="canonical" href="${process.env.SITE_ORIGIN||''}/seo/">
<script type="application/ld+json">${JSON.stringify({
  "@context":"https://schema.org","@type":"TechArticle",
  "headline": title,"datePublished": fmtDate(now),
  "about":"Vendor change monitoring evidence metrics",
  "publisher":{"@type":"Organization","name":"cg-alert"}
})}</script></head><body><main>${body}</main></body></html>`;

const idxBody = `
<h1>Vendor Change Monitoring – ${ym}</h1>
<ul>
  <li>Evidence today: <strong>${k.evidence_today ?? 'n/a'}</strong></li>
  <li>Sent today: <strong>${k.sent_today ?? 'n/a'}</strong></li>
  <li>Hash coverage: <strong>${k.hash_ratio ? (k.hash_ratio*100).toFixed(1)+'%' : 'n/a'}</strong></li>
  <li>TTD P95(h): <strong>${k.ttd_p95_hours ?? 'n/a'} (n=${k.ttd_samples ?? 0})</strong></li>
  <li>Changed vendors (72h): <strong>${k.changed_vendors_72h ?? 'n/a'}</strong></li>
</ul>
<section>
  <h2>Vendors (sample)</h2>
  <ul>${(vendors||[]).slice(0,100).map(v=>`<li><a href="./vendor/${encodeURIComponent(v)}/">${v}</a></li>`).join('\n')}</ul>
</section>`;
writeText(path.join(OUT,'index.html'), layout(`Vendor Change Monitoring – ${ym}`, `Evidence metrics ${ym}`, idxBody));

if (Array.isArray(vendors) && vendors.length) {
  vendors.slice(0,1000).forEach(v=>{
    const vd = path.join(OUT,'vendor', v); ensureDir(vd);
    writeText(path.join(vd,'index.html'),
      layout(`${v} changes ${ym}`, `${v} vendor changes ${ym}`,
        `<h1>${v} – changes & evidence (${ym})</h1><p>Auto-generated landing.</p>`));
  });
}

const monthDir = path.join(OUT,'month', ym); ensureDir(monthDir);
writeText(path.join(monthDir,'index.html'),
  layout(`Monthly rollup ${ym}`, `Metrics rollup ${ym}`, `<h1>${ym} rollup</h1><pre>${JSON.stringify(k,null,2)}</pre>`));

console.log('SEO pages generated → public/seo');
