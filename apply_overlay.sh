#!/usr/bin/env bash
set -euo pipefail
ROOT="$(pwd)"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[1/5] _redirects -> repository root"
install -D -m 0644 "$SRC/_redirects" "$ROOT/_redirects"

echo "[2/5] rss/index.html -> repository root"
install -D -m 0644 "$SRC/rss/index.html" "$ROOT/rss/index.html"

echo "[3/5] scripts/vendors_build.mjs"
install -D -m 0644 "$SRC/scripts/vendors_build.mjs" "$ROOT/scripts/vendors_build.mjs"

echo "[4/5] outreach/compute_limit.js"
install -D -m 0644 "$SRC/outreach/compute_limit.js" "$ROOT/outreach/compute_limit.js"

echo "[5/5] scripts/pricing_sync.js"
install -D -m 0644 "$SRC/scripts/pricing_sync.js" "$ROOT/scripts/pricing_sync.js"

echo "Overlay v3 applied."
git config user.email "bot@cg-alert.com" || true
git config user.name  "cg-alert-bot" || true
git add _redirects rss/index.html scripts/vendors_build.mjs outreach/compute_limit.js scripts/pricing_sync.js || true
if git diff --cached --quiet; then
  echo "No changes to commit (already up-to-date)."
else
  git commit -m "Overlay 1196 v3: root redirects+rss; vendors index; outreach limit hardening; pricing CTA tri-tier"
  git push || true
fi
