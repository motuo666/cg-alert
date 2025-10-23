#!/usr/bin/env bash
set -euo pipefail
MONTH="${1:-$(date +%Y-%m)}"
echo "[monthly] generating monthly report for ${MONTH}"

export SITE_ORIGIN="${SITE_ORIGIN:-https://www.cg-alert.com}"

if [[ -f scripts/build_monthly_report.js ]]; then
  node scripts/build_monthly_report.js "${MONTH}"
elif [[ -f scripts/build_public_monthly_report.js ]]; then
  node scripts/build_public_monthly_report.js "${MONTH}"
else
  echo "::error::No monthly report script (scripts/build_monthly_report.js or scripts/build_public_monthly_report.js)"
  exit 1
fi

git config user.email "bot@cg-alert.com"
git config user.name  "cg-alert-bot"
git add -A public/reports public/seo || true
if git diff --cached --quiet; then
  echo "[monthly] no changes to commit"
else
  git commit -m "reports: monthly ${MONTH}"
  git pull --rebase --autostash || true
  git push || true
fi
