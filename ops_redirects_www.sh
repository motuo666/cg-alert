#!/usr/bin/env bash
set -euo pipefail
F="_redirects"
touch "$F"
# Remove any www->apex rules
tmp="$(mktemp)"; grep -vE '^https://www\.cg-alert\.com/\*\s+https://cg-alert\.com/:' "$F" > "$tmp" || true; mv "$tmp" "$F"
# Add apex->www if missing
if ! grep -qE '^https://cg-alert\.com/\*\s+https://www\.cg-alert\.com/:' "$F"; then
  echo 'https://cg-alert.com/* https://www.cg-alert.com/:splat 301' >> "$F"
fi
echo "Redirects set: apex -> www (301)."
