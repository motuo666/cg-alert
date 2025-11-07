#!/usr/bin/env bash
set -euo pipefail
ROOT="$(pwd)"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[1/4] Update scripts/pricing_sync.js"
install -D -m 0644 "$SRC/scripts/pricing_sync.js" "$ROOT/scripts/pricing_sync.js"

echo "[2/4] Update .github/workflows/drift-guard.yml"
install -D -m 0644 "$SRC/.github/workflows/drift-guard.yml" "$ROOT/.github/workflows/drift-guard.yml"

echo "[3/4] Update .github/workflows/blacklist-refresh.yml"
install -D -m 0644 "$SRC/.github/workflows/blacklist-refresh.yml" "$ROOT/.github/workflows/blacklist-refresh.yml"

echo "[4/4] Update outreach/compute_limit.js"
install -D -m 0644 "$SRC/outreach/compute_limit.js" "$ROOT/outreach/compute_limit.js"

echo "Overlay applied."
git config user.email "bot@cg-alert.com" || true
git config user.name  "cg-alert-bot" || true
git add scripts/pricing_sync.js .github/workflows/drift-guard.yml .github/workflows/blacklist-refresh.yml outreach/compute_limit.js || true
if git diff --cached --quiet; then
  echo "No changes to commit (already up-to-date)."
else
  git commit -m "Apply overlay 1196: pricing CTA tri-tier; probe deps; blacklist fi; KPI hardening" || true
  git push || true
fi
