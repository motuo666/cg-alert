#!/usr/bin/env bash
set -euo pipefail
BASE="${SITE_ORIGIN:-https://www.cg-alert.com}"
echo "[probe] base=$BASE"
urls=( "/" "/seo/" "/reports/" "/who-uses/" "/sitemap.xml" "/rss.xml" )
# sample up to 10 evidence pages if exist
if compgen -G "public/evidence/*/*/*/index.html" > /dev/null; then
  mapfile -t samples < <(ls -1 public/evidence/*/*/*/index.html | head -n 10)
  for f in "${samples[@]}"; do
    rel="${f#public}"
    urls+=("$rel")
  done
fi
fail=0
for u in "${urls[@]}"; do
  full="${BASE%/}${u}"
  code=$(curl -s -o /dev/null -w "%{http_code}" "$full" || true)
  echo "[probe] $code $full"
  if [[ "$code" != "200" && "$code" != "301" && "$code" != "302" ]]; then
    echo "::error::non-2xx/3xx $full -> $code"
    fail=1
  fi
done
exit $fail
