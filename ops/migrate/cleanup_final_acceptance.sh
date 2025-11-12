#!/usr/bin/env bash
set -euo pipefail
FILE="./final-acceptance.yml"
if [[ -f "$FILE" ]]; then
  git rm -f "$FILE" 2>/dev/null || rm -f "$FILE"
  echo "[cleanup] removed stray $FILE"
else
  echo "[cleanup] no stray $FILE"
fi
