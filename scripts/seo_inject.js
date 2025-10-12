#!/usr/bin/env node
// seo_inject.js — add JSON-LD/canonical/description to vendors/*/index.html and updates/index.html (idempotent)
const fs=require('fs'), path=require('path'); const SITE='https://www.cg-alert.com'; const ROOT=path.join(__dirname,'..');
function inject(file, head){ let html=fs.readFileSync(file,'utf8'); if(html.includes('data-cg-seo="1"')) return;
  html=html.replace(/<head([^>]*)>/i, (m,a)=>`<head$1 data-cg-seo="1">\n${head}\n`); fs.writeFileSync(file, html, 'utf8');
}
function vendorHead(slug,lastISO){ const title=`Vendor ${slug} — Public Change Log & Evidence`, desc=`Evidence-backed public changes for ${slug}: Pricing, ToS, DPA, Subprocessors, Status.`, canon=`${SITE}/vendors/${encodeURIComponent(slug)}/`;
  const ld={"@context":"https://schema.org","@type":"TechArticle","headline":title,"about":["Pricing","Terms of Service","DPA","Subprocessors","Status"],"dateModified":lastISO,"mainEntityOfPage":canon,"publisher":{"@type":"Organization","name":"CG Alert","url":SITE},"inLanguage":"en"};
  return [`<title>${title}</title>`,`<meta name="description" content="${desc}">`,`<link rel="canonical" href="${canon}">`,`<script type="application/ld+json">${JSON.stringify(ld)}</script>`].join('\n');
}
function newestISO(slug){ const dir=path.join(ROOT,'evidence',slug); if(!fs.existsSync(dir)) return new Date().toISOString(); let t=0; for(const f of fs.readdirSync(dir)){ if(!/\.json$/i.test(f)) continue; const st=fs.statSync(path.join(dir,f)); if(st.mtimeMs>t) t=st.mtimeMs; } return new Date(t||Date.now()).toISOString(); }
(function main(){
  const V=path.join(ROOT,'vendors'); if(fs.existsSync(V)){ for(const d of fs.readdirSync(V,{withFileTypes:true})){ if(!d.isDirectory()) continue; const slug=d.name; const idx=path.join(V,slug,'index.html'); if(!fs.existsSync(idx)) continue; inject(idx, vendorHead(slug, newestISO(slug))); console.log(`SEO injected: vendors/${slug}/index.html`); } }
  const U=path.join(ROOT,'updates','index.html'); if(fs.existsSync(U)){ const head=`<title>Top Public Changes — CG Alert</title><meta name="description" content="Evidence-backed changes on vendors’ public pages (Pricing/ToS/DPA/Subprocessors/Status)."><link rel="canonical" href="${SITE}/updates/">`; inject(U, head); console.log('SEO injected: updates/index.html'); }
})();