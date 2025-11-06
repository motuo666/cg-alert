#!/usr/bin/env bash
set -euo pipefail
FILE="_redirects"
touch "$FILE"
# Remove any previous host flip rules that force www -> apex
tmp="$(mktemp)"
grep -vE '^https://www\.cg-alert\.com/\*\s+https://cg-alert\.com/:' "$FILE" > "$tmp" || true
mv "$tmp" "$FILE"
# Ensure apex -> www rule exists (host 301)
if ! grep -qE '^https://cg-alert\.com/\*\s+https://www\.cg-alert\.com/:' "$FILE"; then
  echo 'https://cg-alert.com/* https://www.cg-alert.com/:splat 301' >> "$FILE"
fi
echo "Redirects normalized: apex -> www (301)"
