#!/usr/bin/env bash
set -Eeuo pipefail

echo "== CG Alert: Restore Original Homepage =="

ROOT="$(pwd)"

choose_candidate() {
  # Priority 0: explicit pointer
  if [[ -f ".home_origin" ]]; then
    local target; target="$(cat .home_origin | tr -d '\r')"
    [[ -n "$target" && -f "$target" ]] && echo "$target" && return 0
  fi

  # Priority 1: explicit originals
  for f in "index.original.html" "home.html" "landing.html" "index_home.html"; do
    [[ -f "$f" ]] && echo "$f" && return 0
  done
  for f in "public/index.original.html"; do
    [[ -f "$f" ]] && echo "$f" && return 0
  done

  # Priority 2: reports index at root
  if [[ -f "reports/index.html" ]]; then
    echo "reports/index.html" && return 0
  fi

  # Priority 3: reports/YYYY-*/index.html — choose latest by lexicographic (YYYY-...)
  if compgen -G "reports/20*/index.html" > /dev/null; then
    # sort descending and pick first
    local pick
    pick="$(ls -1d reports/20*/index.html | sort -r | head -n1)"
    [[ -n "$pick" ]] && echo "$pick" && return 0
  fi

  # Priority 4: public/index.html (if it's not a meta-refresh to /seo/)
  if [[ -f "public/index.html" ]]; then
    if ! grep -qi 'http-equiv="refresh".*/seo/' "public/index.html" 2>/dev/null; then
      echo "public/index.html" && return 0
    fi
  fi

  # Priority 5 (last resort): public/seo/index.html
  if [[ -f "public/seo/index.html" ]]; then
    echo "public/seo/index.html" && return 0
  fi

  return 1
}

CANDIDATE="$(choose_candidate || true)"
if [[ -z "${CANDIDATE:-}" ]]; then
  echo "::error::Unable to detect original homepage. Create a file .home_origin with the path to your intended homepage (e.g., reports/2025-09/index.html)."
  exit 1
fi

echo "Chosen original homepage: $CANDIDATE"

# Remove '/ -> /seo/' redirects if present (root and public)
strip_redirect() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  tmp="$(mktemp)"
  grep -Ev '^[[:space:]]*/[[:space:]]+/seo/[[:space:]]+301[[:space:]]*$' "$f" > "$tmp" || true
  mv "$tmp" "$f"
}

strip_redirect "_redirects"
strip_redirect "public/_redirects"

# Propagate homepage to root /index.html and public/index.html
install_home() {
  local src="$1"
  mkdir -p "$(dirname "index.html")" "public"
  cp -f "$src" "index.html"
  cp -f "$src" "public/index.html"
}

install_home "$CANDIDATE"

echo "Restored homepage to ./index.html and ./public/index.html"
echo "Done."
