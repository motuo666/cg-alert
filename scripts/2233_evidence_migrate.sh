#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
# Ensure target exists
mkdir -p cg-alert-main/evidence
# Move without overwrite
rsync -a --ignore-existing cg-alert-main/public/evidence/ cg-alert-main/evidence/ 2>/dev/null || true
# Replace links in cg-alert-main
find cg-alert-main -type f -name "*.html" -print0 | xargs -0 sed -i 's|/public/evidence|/evidence|g'
echo "evidence migration complete."
