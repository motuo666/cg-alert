#!/usr/bin/env bash
set -euo pipefail
if [ ! -d ".git" ]; then echo "Run in repo root (has .git/)"; exit 1; fi

echo ">>> Style unify smart: ensure canonical CSS present in public/ and inject across pages"
node scripts/style-unify-smart.mjs

git config user.email "bot@cg-alert.com"
git config user.name  "cg-alert-bot"
if ! git diff --quiet; then
  git add -A
  git commit -m "Style unify: migrate canonical CSS to public/ & inject site-wide"
  echo "Committed."
else
  echo "No changes."
fi
