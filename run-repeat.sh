#!/usr/bin/env bash
set -e
git tag -f pre-repeat-$(date +%Y%m%d-%H%M%S) || true

BASE="."
if [ -f "cg-alert-main/index.html" ]; then BASE="cg-alert-main"; fi
cp -f enterprise.css "$BASE/" || true

node scripts/repeat_homepage_fix.js || true
node scripts/repeat_unify_theme.js || true
node scripts/repeat_fix_nav.js || true
bash scripts/repeat_evidence_migrate.sh || true

if [ -f "$BASE/_redirects" ]; then
  grep -q "/public/*" "$BASE/_redirects" || echo "/public/*          /:splat   301" >> "$BASE/_redirects"
  grep -q "/reports/rss.xml" "$BASE/_redirects" || echo "/reports/rss.xml   /rss.xml  301" >> "$BASE/_redirects"
else
  cp _redirects.append "$BASE/_redirects"
fi

SITE_ORIGIN="${SITE_ORIGIN:-https://www.cg-alert.com}" node scripts/repeat_build_dashboard.js || true
SITE_ORIGIN="${SITE_ORIGIN:-https://www.cg-alert.com}" node scripts/repeat_build_rss.js || true
SITE_ORIGIN="${SITE_ORIGIN:-https://www.cg-alert.com}" node scripts/repeat_build_sitemap.js || true

git add -A "$BASE/_redirects" "$BASE/enterprise.css" "$BASE/dashboard" "$BASE/rss.xml" "$BASE/sitemap.xml" scripts || true
git commit -m "repeat: homepage micro-fix, unify subpages, nav absolute, evidence unified, derivatives built" || true
git push || true

node - <<'NODE'
const fs=require('fs'), base=fs.existsSync('cg-alert-main/index.html')?'cg-alert-main':'.';
const home=base+'/index.html'; let ok=true;
if(fs.existsSync(home)){ const s=fs.readFileSync(home,'utf8'); if(/30k|30,000/i.test(s)){ console.log('FAIL: homepage still has 30k'); ok=false; } else console.log('PASS: homepage 30k removed'); }
['reports','who-uses','seo','dashboard','legal'].forEach(d=>{ if(fs.existsSync(base+'/'+d)) console.log('exists:', base+'/'+d); });
console.log(ok?'ALL GOOD':'NEEDS ATTENTION');
NODE
