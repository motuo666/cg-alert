#!/usr/bin/env bash
set -euo pipefail

# 用法：bash scripts/compute_weekly_hash.sh public/reports/weekly_hash.json
out="${1:-public/reports/weekly_hash.json}"

echo "[hash] computing aggregate hash over public/reports and public/evidence"

# 收集需要纳入周度总哈希的文件（报告/证据页）
list_files() {
  find public/reports  -type f \( -name '*.json' -o -name '*.html' -o -name '*.xml' \) 2>/dev/null || true
  find public/evidence -type f \( -name '*.html' -o -name '*.json' \) 2>/dev/null || true
}

# 按文件名排序后逐个取单文件哈希，再拼接取总哈希（顺序稳定）
if command -v sha256sum >/dev/null 2>&1; then
  sha=$(list_files | sort | xargs -r sha256sum | awk '{print $1}' | tr -d '\n' | sha256sum | awk '{print $1}')
else
  tmp=$(mktemp)
  list_files | sort | while read -r f; do openssl dgst -sha256 "$f" | awk '{print $2}'; done | tr -d '\n' > "$tmp"
  sha=$(openssl dgst -sha256 "$tmp" | awk '{print $2}')
  rm -f "$tmp"
fi

week=$(date -u +%G%V)             # ISO 年+周，例如 202543
ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p "$(dirname "$out")"
printf '{"sha256":"%s","iso_week":"%s","timestamp":"%s"}\n' "$sha" "$week" "$ts" > "$out"

# —— 关键兜底：确保本地仓库有 git 身份，避免 empty ident name —— #
if ! git config user.email >/dev/null 2>&1 || [[ -z "$(git config user.email || true)" ]]; then
  git config user.email "bot@cg-alert.com"
fi
if ! git config user.name  >/dev/null 2>&1 || [[ -z "$(git config user.name  || true)" ]]; then
  git config user.name  "cg-alert-bot"
fi

# 提交并推送（无变更时不报错）
git add "$out"
git commit -m "weekly evidence hash: $sha (iso week $week)" || echo "[hash] no changes to commit"
git pull --rebase --autostash || true
git push || true

echo "[hash] aggregate $sha (iso week $week)"
