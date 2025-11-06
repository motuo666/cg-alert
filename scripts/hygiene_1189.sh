#!/usr/bin/env bash
set -euo pipefail
# Append wrangler ignore rules to .gitignore (idempotent)
if ! grep -q 'wrangler.toml' .gitignore 2>/dev/null; then
  cat .gitignore.append >> .gitignore
  echo "Appended wrangler ignore rules to .gitignore"
else
  echo "wrangler ignore rules already present"
fi
# Optional: remove debug sink after Stripe loop is verified
if [ "${1:-keep}" = "remove-sink" ]; then
  if [ -f .github/workflows/stripe-dispatch-sink.yml ]; then
    git rm -f .github/workflows/stripe-dispatch-sink.yml || true
    echo "Removed debug sink workflow"
  else
    echo "No sink workflow to remove"
  fi
fi
echo "Next: git add -A && git commit -m 'chore: 1189 hygiene (wrangler ignore [+ optional sink removal])' && git push"
