#!/usr/bin/env bash
set -euo pipefail

if [ ! -d ".git" ]; then
  echo "Run this from your git repo root (where .git/ exists)."; exit 1
fi

echo "=== CG Alert Final Integrator (1159) ==="

mkdir -p public/.well-known public/evidence/_common scripts/patch_assets

move_if_exists() {
  local p="$1"
  if [ -e "$p" ]; then
    mkdir -p "public/$(dirname "$p")"
    git mv -k "$p" "public/$p" || true
  fi
}

for p in index.html about dashboard deal-desk faq intake privacy terms who-uses reports          rss.xml site.webmanifest _headers _redirects security.txt; do
  move_if_exists "$p"
done

if [ -e ".well-known/security.txt" ]; then
  mkdir -p public/.well-known
  git mv -k ".well-known/security.txt" "public/.well-known/security.txt" || true
fi

if [ -f "robots.txt" ] && [ -f "public/robots.txt" ]; then
  git rm -f robots.txt || true
fi

cp -f scripts/patch_assets/fallback.css public/evidence/_common/fallback.css || true
mkdir -p public/seo
cp -f scripts/patch_assets/seo_index.html public/seo/index.html || true

git add public/evidence/_common/fallback.css public/seo/index.html || true

git add scripts/normalize_evidence.mjs scripts/linkcheck.mjs scripts/inject_meta.mjs scripts/lcp_preload.mjs || true
git add .github/workflows/site-polish.yml .github/workflows/site-qa.yml .github/workflows/seo-ping.yml .github/workflows/assets-guard.yml || true

echo ">>> Normalize evidence (enhanced)"
node scripts/normalize_evidence.mjs || true

echo ">>> Inject OG/Twitter meta"
node scripts/inject_meta.mjs || true

echo ">>> Add LCP preload"
node scripts/lcp_preload.mjs || true

echo ">>> Linkcheck STRICT=true"
STRICT=true node scripts/linkcheck.mjs || true

git config user.email "bot@cg-alert.com"
git config user.name  "cg-alert-bot"
if ! git diff --quiet; then
  git add -A
  git commit -m "Final(1159): unify to public/, add SEO hub, normalize evidence assets, meta, LCP, strict QA"
  echo "Committed local changes."
else
  echo "No changes to commit."
fi

echo "=== Done. Push and redeploy (Cloudflare Pages output=public) ==="
