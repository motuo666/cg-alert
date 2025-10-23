#!/usr/bin/env bash
set -euo pipefail

echo "[poller] start $(date -Is)"

# Unify Slack webhook naming (accept either env)
if [[ -z "${SLACK_WEBHOOK:-}" && -n "${SLACK_WEBHOOK_URL:-}" ]]; then
  export SLACK_WEBHOOK="${SLACK_WEBHOOK_URL}"
fi

export SITE_ORIGIN="${SITE_ORIGIN:-https://www.cg-alert.com}"
export NODE_OPTIONS="--max_old_space_size=3072"

# Install deps if package.json exists
if [[ -f package.json ]]; then
  echo "[poller] npm ci (if lock present)"
  (npm ci || npm i) >/dev/null 2>&1 || true
fi

# Run poller — try known entrypoints, fail if none
if [[ -f scripts/build_change_pack.js ]]; then
  echo "[poller] node scripts/build_change_pack.js"
  node scripts/build_change_pack.js
elif [[ -f scripts/public_change_poller.js ]]; then
  echo "[poller] node scripts/public_change_poller.js"
  node scripts/public_change_poller.js
elif [[ -f scripts/public_change_poller.mjs ]]; then
  echo "[poller] node scripts/public_change_poller.mjs"
  node scripts/public_change_poller.mjs
else
  echo "::error::No poller entrypoint found (scripts/build_change_pack.js or scripts/public_change_poller.*)"
  exit 1
fi

# Generate visual diffs when prev/curr exist
if [[ -f scripts/generate_diff_html.js ]]; then
  echo "[poller] node scripts/generate_diff_html.js public/evidence"
  node scripts/generate_diff_html.js public/evidence || true
fi

# Commit any new evidence/reports
git config user.email "bot@cg-alert.com"
git config user.name  "cg-alert-bot"
git add -A public/evidence public/reports public/rss.xml public/sitemap.xml || true
if git diff --cached --quiet; then
  echo "[poller] no changes to commit"
else
  git commit -m "evidence: poller outputs + diffs"
  git pull --rebase --autostash || true
  git push || true
fi

echo "[poller] done $(date -Is)"
