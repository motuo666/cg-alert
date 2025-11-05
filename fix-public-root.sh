#!/usr/bin/env bash
set -euo pipefail
if [ ! -d ".git" ]; then echo "Run in repo root (has .git/)"; exit 1; fi

mkdir -p public

# Move index.html if it exists at repo root but not in public/
if [ -f "index.html" ] && [ ! -f "public/index.html" ]; then
  git mv -k index.html public/index.html || true
  echo "Moved index.html -> public/index.html"
fi

# Move assets/ directory if exists at repo root and not under public/
if [ -d "assets" ] && [ ! -d "public/assets" ]; then
  mkdir -p public/assets
  git mv -k assets/* public/assets/ || true
  echo "Moved assets/* -> public/assets/"
fi

git config user.email "bot@cg-alert.com"
git config user.name  "cg-alert-bot"
if ! git diff --quiet; then
  git add -A
  git commit -m "Public root fix: move index.html and assets/ under public/"
  echo "Committed."
else
  echo "No changes."
fi
