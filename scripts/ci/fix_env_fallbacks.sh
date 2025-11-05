#!/usr/bin/env bash
# fix_env_fallbacks.sh — 清理 GitHub Actions 表达式层的 '||'，改为显式 secrets/vars；兜底逻辑请放到 bash 运行时。
set -euo pipefail
shopt -s nullglob
echo "[fix] scanning .github/workflows for '||' fallbacks ..."
for f in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$f" ] || continue
  cp "$f" "$f.bak-final" || true
  # 常见两种顺序：vars || secrets、secrets || vars
  sed -E -i '
    s/\$\{\{ *vars\.([A-Za-z0-9_]+) *\|\| *secrets\.[A-Za-z0-9_]+ *\}\}/\$\{\{ vars.\1 \}\}/g;
    s/\$\{\{ *secrets\.([A-Za-z0-9_]+) *\|\| *vars\.[A-Za-z0-9_]+ *\}\}/\$\{\{ secrets.\1 \}\}/g;
  ' "$f" || true
done
echo "[fix] done. 请在运行步骤里做优先 secrets、兜底 vars 的 bash 检查，并保留 fail-fast。"
