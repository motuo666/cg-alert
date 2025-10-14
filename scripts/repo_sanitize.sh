#!/usr/bin/env bash
set -euo pipefail
git config user.name  "CG Bot"
git config user.email "bot@cg-alert.com"

# 删除错误命名的缓存产物（以前 poll 脚本写的）
git ls-files | grep -E '^%2Fhome%2F|%2Frunner%2Fwork%2Fcg-alert%2Fcg-alert%2F\.cache%2Fhttp%2F' | xargs -r git rm -f

# 保留正确目录下的 .cache/http/*
# 可选：限制 .cache 进入版本库（建议忽略）
if [ -f .gitignore ] && ! grep -qE '^\.\s*cache/' .gitignore; then
  echo ".cache/" >> .gitignore
fi

git add -A
git commit -m "chore: sanitize repo cache artifacts" || true
git pull --rebase --autostash origin main || (git rebase --abort || true)
git push origin HEAD:main
