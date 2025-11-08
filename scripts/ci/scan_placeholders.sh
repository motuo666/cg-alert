#!/usr/bin/env bash
set -euo pipefail

echo "[scan] placeholder scan starting..."

EXCLUDES=(
  ".git"
  "node_modules"
  "dist"
  "build"
  "out"
  "docs"
  "evidence/.pending"
  "assets"
)

# Only scan code & config
INCLUDE_EXT="\.(mjs|cjs|js|ts|json|yml|yaml|sh|md)$"

ERR_PAT="(<<ImageDisplayed>>|conversation too long; truncated)"
WARN_PAT="(TODO|FIXME)"

mapfile -t files < <(find . -type f \
  ! -path "*/.*" \
  $(printf ' ! -path "*/%s/*" ' "${EXCLUDES[@]}") \
  | grep -E "${INCLUDE_EXT}" || true)

errs=0

if grep -RIn -- "${files[@]}" -E "$ERR_PAT" >/tmp/scan_errors.txt 2>/dev/null; then
  echo "::group::Blocking placeholder found"
  cat /tmp/scan_errors.txt
  echo "::endgroup::"
  errs=1
else
  echo "[scan] no blocking placeholders"
fi

if grep -RIn -- "${files[@]}" -E "$WARN_PAT" >/tmp/scan_warnings.txt 2>/dev/null; then
  echo "::group::Warning: Found TODO/FIXME"
  cat /tmp/scan_warnings.txt
  echo "::endgroup::"
  echo "::warning::Found TODO/FIXME comments (non-blocking)."
else
  echo "[scan] no TODO/FIXME found"
fi

exit $errs
