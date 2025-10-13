#!/usr/bin/env node
// ensure_vendor_skeletons.js — 从 data/domains.csv 生成缺失的 vendors/<slug>/index.html 骨架页（幂等）
const fs=require('fs'), path=require('path'); const SITE='https://www.cg-alert.com';
const domFile=path.join('data','domains.csv'); if(!fs.existsSync(domFile)) process.exit(0);
const domains=fs.readFileSync(domFile,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
for(const d of domains){
  const slug=d.replace(/^www\./,'').toLowerCase();
  const dir=path.join('vendors',slug); const idx=path.join(dir,'index.html');
  if (fs.existsSync(idx)) continue;
  fs.mkdirSync(dir,{recursive:true});
  const title=`Vendor ${slug} — Public Change Log & Evidence`;
  const canon=`${SITE}/vendors/${encodeURIComponent(slug)}/`;
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${title}</title><meta name="description" content="Evidence-backed public changes for ${slug}: Pricing, ToS, DPA, Subprocessors, Status.">
<link rel="canonical" href="${canon}"></head>
<body data-cg-skel="1" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial">
<div class="wrap" style="max-width:860px;margin:0 auto;padding:28px 16px">
<h1>${slug}</h1>
<p>We track public changes for <b>${slug}</b> (Pricing/ToS/DPA/Subprocessors/Status). Evidence appears here as it’s detected.</p>
<p><a href="/updates/">Recent updates</a> · <a href="/reports/">Monthly reports</a></p>
</div></body></html>`;
  fs.writeFileSync(idx, html, 'utf8');
  console.log('created skeleton:', `vendors/${slug}/index.html`);
}
