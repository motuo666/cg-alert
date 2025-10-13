#!/usr/bin/env bash
set -euo pipefail

MSG="${1:-"chore: automated update"}"

git config user.name "CG Bot"
git config user.email "bot@cg-alert.com"

# 确保有完整历史，便于 rebase
git fetch origin main --depth=0 || true

# 没变化则直接退出
if git diff --quiet; then
  echo "no changes"; exit 0
fi

git add -A
git commit -m "$MSG" || true

# 三次重试：push → fetch+rebase → force-with-lease
for i in 1 2 3; do
  if git push origin HEAD:main; then
    echo "pushed"; exit 0
  fi
  echo "push rejected, retry $i: rebase with origin/main"
  git fetch origin main --depth=0 || true
  if ! git rebase origin/main; then
    echo "rebase conflict, try merge fallback"
    git rebase --abort || true
    git merge --no-edit origin/main || true
  fi
  if git push --force-with-lease origin HEAD:main; then
    echo "force-with-lease pushed"; exit 0
  fi
  sleep $((RANDOM%5+2))
done

echo "safe push failed after retries"
exit 1
