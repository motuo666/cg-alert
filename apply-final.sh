#!/usr/bin/env bash
set -euo pipefail

if [ ! -d ".git" ]; then
  echo "Run this from your git repo root (where .git/ exists)."; exit 1
fi

echo "=== CG Alert Final Integrator ==="

# --- 0) Ensure dirs ---
mkdir -p public/.well-known public/evidence/_common scripts/patch_assets

# --- 1) Move root pages/files into public/ (idempotent) ---
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

# Prefer public/robots.txt; remove root robots if duplicate
if [ -f "robots.txt" ] && [ -f "public/robots.txt" ]; then
  git rm -f robots.txt || true
fi

# --- 2) Install assets & pages ---
cp -f scripts/patch_assets/fallback.css public/evidence/_common/fallback.css || true
mkdir -p public/seo
cp -f scripts/patch_assets/seo_index.html public/seo/index.html || true

git add public/evidence/_common/fallback.css public/seo/index.html || true

# --- 3) Add/Update scripts ---
git add scripts/normalize_evidence.mjs scripts/linkcheck.mjs scripts/inject_meta.mjs scripts/lcp_preload.mjs || true

# --- 4) Add/Update workflows ---
git add .github/workflows/site-polish.yml .github/workflows/site-qa.yml .github/workflows/seo-ping.yml .github/workflows/assets-guard.yml || true

# --- 5) Run polish tasks locally (best-effort) ---
echo ">>> Normalize evidence (enhanced)"
node scripts/normalize_evidence.mjs || true

echo ">>> Inject OG/Twitter meta"
node scripts/inject_meta.mjs || true

echo ">>> Add LCP preload"
node scripts/lcp_preload.mjs || true

echo ">>> Linkcheck STRICT=true"
STRICT=true node scripts/linkcheck.mjs || true

# --- 6) Commit ---
git config user.email "bot@cg-alert.com"
git config user.name  "cg-alert-bot"
if ! git diff --quiet; then
  git add -A
  git commit -m "Final: unify site to public/, add SEO hub, normalize evidence assets, meta, LCP, strict QA"
  echo "Committed local changes."
else
  echo "No changes to commit."
fi

echo "=== Done. Push and redeploy (Cloudflare Pages output=public) ==="
