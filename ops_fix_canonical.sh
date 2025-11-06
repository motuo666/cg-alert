#!/usr/bin/env bash
set -euo pipefail
TARGET="https://www.cg-alert.com"
find . -type f -name "*.html" -print0 | while IFS= read -r -d '' f; do
  if grep -qE '<link\s+rel="canonical"' "$f"; then
    # normalize any existing canonical to TARGET
    sed -i "s|<link rel=\"canonical\" href=\"https://cg-alert.com/|<link rel=\"canonical\" href=\"${TARGET}/|g" "$f"
    sed -i "s|<link rel=\"canonical\" href=\"https://cg-alert.com|<link rel=\"canonical\" href=\"${TARGET}|g" "$f"
    sed -i "s|<link rel=\"canonical\" href=\"https://www.cg-alert.com/|<link rel=\"canonical\" href=\"${TARGET}/|g" "$f"
  fi
done
echo "Canonical URLs normalized to ${TARGET}"
