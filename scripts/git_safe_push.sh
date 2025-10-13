#!/usr/bin/env bash
set -euo pipefail
MSG="${1:-"chore: automated update"}"

git config user.name "CG Bot"
git config user.email "bot@cg-alert.com"

# 拉取远端，避免 non-fast-forward
git fetch origin || true

# 没变化就退出
if git diff --quiet; then
  echo "no changes"
  exit 0
fi

git add -A
git commit -m "$MSG" || true

# 最多 3 次重试（rebase 优先，失败退化到 merge）
for i in 1 2 3; do
  if git push origin HEAD:main; then
    exit 0
  fi
  git pull --rebase origin main || git merge --no-edit origin/main || true
done

echo "safe push failed"
exit 1
