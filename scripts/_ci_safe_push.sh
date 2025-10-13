#!/usr/bin/env bash
set -euo pipefail

branch="${1:-main}"
remote="${2:-origin}"
max_tries="${3:-5}"

git config user.name  "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

tries=0
while [ $tries -lt $max_tries ]; do
  # 先拿远端最新
  git fetch --all || true
  git pull --rebase --autostash "$remote" "$branch" || git rebase --abort || true

  if git push "$remote" "HEAD:$branch"; then
    echo "Safe push OK"
    exit 0
  fi

  tries=$((tries+1))
  echo "Push race, retry #$tries in 3s..."
  sleep 3
done

echo "Safe push FAILED after $max_tries tries"
exit 1
