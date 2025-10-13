#!/usr/bin/env bash
set -euo pipefail
MSG="${1:-"chore: automated update"}"
git config user.name "CG Bot"
git config user.email "bot@cg-alert.com"
git fetch origin main --depth=0 || true
if git diff --quiet; then echo "no changes"; exit 0; fi
git add -A
git commit -m "$MSG" || true
for i in 1 2 3; do
  if git push origin HEAD:main; then exit 0; fi
  git fetch origin main --depth=0 || true
  git rebase origin/main || (git rebase --abort || true; git merge --no-edit origin/main || true)
  git push --force-with-lease origin HEAD:main && exit 0 || sleep $((RANDOM%5+2))
done
echo "safe push failed"; exit 1
