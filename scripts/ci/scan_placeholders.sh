#!/usr/bin/env bash
set -euo pipefail

# Scan repository for blocking placeholder artifacts that should never ship.
# Exit non-zero if any blocking patterns are found.
# Non-blocking items (TODO/FIXME) are only warned.

ROOT="${1:-.}"

echo "[scan] placeholder scan starting at $ROOT"

# Exclude noisy or generated directories
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

# Build find expression to exclude directories
find_args=( "$ROOT" -type f )
for ex in "${EXCLUDES[@]}"; do
  find_args+=( -path "$ROOT/$ex/*" -prune -o )
done
find_args+=( -type f -print )

# Collect candidate files
mapfile -t files < <(find "${find_args[@]}" 2>/dev/null)

if [ "${#files[@]}" -eq 0 ]; then
  echo "[scan] nothing to scan"
  exit 0
fi

# Patterns
BLOCK_PAT='(<<ImageDisplayed>>|conversation too long; truncated)'
WARN_PAT='(^|[^A-Za-z])(TODO|FIXME)([^A-Za-z]|$)'

errs=0

# Blocking scan
if grep -RIn -E "$BLOCK_PAT" -- "${files[@]}" > /tmp/scan_block.txt 2>/dev/null; then
  echo "::group::Blocking placeholder(s) found"
  cat /tmp/scan_block.txt
  echo "::endgroup::"
  echo "::error::Blocking placeholder markers found. Remove them before shipping."
  errs=1
else
  echo "[scan] no blocking placeholders"
fi

# Non-blocking warnings
if grep -RIn -E "$WARN_PAT" -- "${files[@]}" > /tmp/scan_warnings.txt 2>/dev/null; then
  echo "::group::Warning: Found TODO/FIXME"
  cat /tmp/scan_warnings.txt
  echo "::endgroup::"
  echo "::warning::Found TODO/FIXME comments (non-blocking)."
else
  echo "[scan] no TODO/FIXME found"
fi

exit "$errs"
