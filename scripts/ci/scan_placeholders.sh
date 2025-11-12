#!/usr/bin/env bash
set -euo pipefail
# This scan intentionally avoids embedding forbidden tokens literally to prevent self-matches.
# We split the sensitive phrase so literal scanners won't trip on this file.
PART1='conversation too long; trun'
PART2='cated'
BLOCK_PAT='(<<ImageDisplayed>>|'"${PART1}${PART2}"')'
echo "[scan] scanning tree for placeholder artifacts ..."
hits=$(grep -RInE "${BLOCK_PAT}" --exclude-dir=.git --exclude-dir=.github --exclude="$0" || true)
if [[ -n "${hits}" ]]; then
  echo "::error::Placeholder-like artifacts found:"
  echo "${hits}"
  exit 1
fi
echo "[scan] ok"
