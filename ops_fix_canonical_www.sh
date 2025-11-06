#!/usr/bin/env bash
set -euo pipefail
BASE="https://www.cg-alert.com"
fix_file() {
  f="$1"
  # only if canonical exists
  if ! grep -qE '<link\s+rel="canonical"' "$f"; then return 0; fi
  # href="/path"  -> href="https://www.cg-alert.com/path"
  sed -i -E 's|(<link\s+rel="canonical"\s+href=")/([^"]*)("|)|\1'"$BASE"'/\2\3|g' "$f"
  # href="https://cg-alert.com/..." -> www 版
  sed -i -E 's|href="https://cg-alert.com|href="'"$BASE"'|g' "$f"
  # href="//cg-alert.com/..." -> 显式 https + www
  sed -i -E 's|href="//cg-alert.com|href="'"$BASE"|' "$f"
  # href="//www.cg-alert.com/..." -> 显式 https
  sed -i -E 's|href="//www.cg-alert.com|href="'"$BASE"|' "$f"
  # 确保以 BASE 开头
}
export -f fix_file
find . -type f -name "*.html" -print0 | xargs -0 -I{} bash -c 'fix_file "$@"' _ {}
echo "Canonical normalized to ${BASE} (relative + apex -> www)."
