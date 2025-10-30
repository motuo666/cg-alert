#!/usr/bin/env bash
set -e
BASE="."
if [ -f "cg-alert-main/index.html" ]; then BASE="cg-alert-main"; fi
mkdir -p "$BASE/evidence"
rsync -a --ignore-existing "$BASE/public/evidence/" "$BASE/evidence/" 2>/dev/null || true
rsync -a --ignore-existing "public/evidence/" "$BASE/evidence/" 2>/dev/null || true
find "$BASE" -type f -name "*.html" -print0 | xargs -0 sed -i 's|/public/evidence|/evidence|g'
echo "evidence merged into $BASE/evidence"
