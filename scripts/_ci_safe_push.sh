#!/usr/bin/env bash
# _ci_safe_push.sh — 安全推送：设置身份 → commit → pull --rebase --autostash → push(重试3次)
# 用法：scripts/_ci_safe_push.sh <branch> "<commit message>"
# 输出：$GITHUB_OUTPUT: changed=0/1, pushed=0/1
set -euo pipefail
BRANCH="${1:-main}"
COMMIT_MSG="${2:-chore: update}"

# identity (repo-local)
if ! git config --get user.name >/dev/null 2>&1; then
  git config --local user.name "${GIT_COMMIT_NAME:-CG Bot}"
fi
if ! git config --get user.email >/dev/null 2>&1; then
  git config --local user.email "${GIT_COMMIT_EMAIL:-bot@cg-alert.com}"
fi

# detect changes
if git diff --quiet; then
  echo "No changes."
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "changed=0" >> "$GITHUB_OUTPUT"; echo "pushed=0" >> "$GITHUB_OUTPUT"; fi
  exit 0
fi

git add -A
git commit -m "$COMMIT_MSG"

pushed=0
for i in 1 2 3; do
  git pull --rebase --autostash origin "$BRANCH" || (git rebase --abort || true)
  if git push origin HEAD:"$BRANCH"; then pushed=1; break; fi
  echo "Push failed. Retry #$i..."; sleep 3
done

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "changed=1" >> "$GITHUB_OUTPUT"
  echo "pushed=$pushed" >> "$GITHUB_OUTPUT"
fi

exit 0
