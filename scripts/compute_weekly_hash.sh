#!/usr/bin/env bash
set -euo pipefail
OUT="${1:-public/reports/weekly_hash.json}"
TMP="$(mktemp)"
echo "[hash] computing aggregate hash over public/reports and public/evidence"
sha256sum $(git ls-files 'public/reports/**' 'public/evidence/**' 2>/dev/null || true) 2>/dev/null | sort -k2 > "$TMP" || true
if [[ ! -s "$TMP" ]]; then
  echo "::warning::No files under public/reports or public/evidence to hash"
  exit 0
fi
AGG=$(sha256sum "$TMP" | cut -d' ' -f1)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
YEARWEEK=$(date -u +%G%V)
mkdir -p "$(dirname "$OUT")"
if command -v jq >/dev/null 2>&1; then
  jq -n --arg agg "$AGG" --arg ts "$TS" --arg yw "$YEARWEEK"         '{aggregate_sha256:$agg, generated_at:$ts, iso_yearweek:$yw}' > "$OUT"
else
  echo "{\"aggregate_sha256\": \"$AGG\", \"generated_at\": \"$TS\", \"iso_yearweek\": \"$YEARWEEK\"}" > "$OUT"
fi
echo "[hash] aggregate $AGG (iso week $YEARWEEK)"
if git rev-parse --git-dir >/dev/null 2>&1; then
  git add "$OUT" || true
  if ! git tag -l | grep -q "evidence-weekly-$YEARWEEK"; then
    git tag -a "evidence-weekly-$YEARWEEK" -m "aggregate $AGG"
  fi
fi
