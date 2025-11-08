#!/usr/bin/env bash
set -euo pipefail
git config user.email "bot@cg-alert.com"
git config user.name  "cg-alert-bot"
# Safely add only if path exists
add_if_exists() {
  for p in "$@"; do
    if [ -e "$p" ]; then
      git add -A "$p"
    fi
  done
}
add_if_exists vendors updates public site build dist docs out _headers reports seo evidence data
if git diff --cached --quiet; then
  echo "no changes to commit"
else
  git commit -m "${1:-automated commit}"
  git pull --rebase --autostash || true
  git push || true
fi
