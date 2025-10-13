#!/usr/bin/env bash
# 安全推送脚本：设置提交身份 → 检测变更 → commit → pull --rebase --autostash → push(最多3次)
# 用法：scripts/_ci_safe_push.sh <branch> "<commit message>"
# 输出到 $GITHUB_OUTPUT: changed=0/1, pushed=0/1

set -euo pipefail

BRANCH="${1:-main}"
COMMIT_MSG="${2:-chore: update}"

# 1) 确保提交身份（仅设本仓库，不污染 Runner 全局）
if ! git config --get user.name >/dev/null; then
  git config --local user.name "${GIT_COMMIT_NAME:-CG Bot}"
fi
if ! git config --get user.email >/dev/null; then
  git config --local user.email "${GIT_COMMIT_EMAIL:-bot@cg-alert.com}"
fi

# 2) 没有变更就直接绿
if git diff --quiet; then
  echo "No changes to commit."
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "changed=0" >> "$GITHUB_OUTPUT"
    echo "pushed=0"  >> "$GITHUB_OUTPUT"
  fi
  exit 0
fi

# 3) commit
git add -A
git commit -m "$COMMIT_MSG"

# 4) 安全 push（带 rebase+自动暂存，最多3次）
pushed=0
for i in 1 2 3; do
  git pull --rebase --autostash origin "$BRANCH" || (git rebase --abort || true)
  if git push origin HEAD:"$BRANCH"; then
    pushed=1
    break
  fi
  echo "Push failed. Retry #$i ..."
  sleep 3
done

# 5) 输出状态供后续步骤判断
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "changed=1" >> "$GITHUB_OUTPUT"
  echo "pushed=$pushed" >> "$GITHUB_OUTPUT"
fi

# 永远 exit 0，把失败留给上游决定是否兜底 PR
exit 0
