#!/usr/bin/env bash
set -euo pipefail

echo "[scan] placeholder scan starting..."

# Directories to exclude
EXCLUDES=(
  ".git"
  "node_modules"
  "dist"
  "build"
  "out"
  "docs"
  "evidence/.pending"
)

# Build find prune expression
PRUNE_EXPR=""
for d in "${EXCLUDES[@]}"; do
  PRUNE_EXPR+="-path ./$d -prune -o "
done

# File globs to check (code-ish)
INCLUDE_EXT="\( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.ts' -o -name '*.tsx' -o -name '*.sh' -o -name '*.py' -o -name '*.go' -o -name '*.rb' -o -name '*.yml' -o -name '*.yaml' -o -name '*.json' -o -name '*.md' -o -name '*.txt' -o -name '*.env' \)"

# Hard errors: obvious placeholders that must not ship
ERROR_PAT='(<<ImageDisplayed>>|conversation too long; truncated|https://buy\.stripe\.com/\.\.\.|https://forms\.gle/\.\.\.|YOUR_NETLIFY_SITE_URL)'
# Warnings: TODO / FIXME mentions
WARN_PAT='(^|\W)(TODO|FIXME)(\W|$)'

errs=0

# Collect files
mapfile -t files < <(eval "find . ${PRUNE_EXPR} -type f ${INCLUDE_EXT} -print")

if [ "${#files[@]}" -eq 0 ]; then
  echo "[scan] no files to scan (ok)"
  exit 0
fi

echo "[scan] scanning ${#files[@]} files..."

# Scan for hard errors
if grep -RIn -- "${files[@]}" -E "$ERROR_PAT" >/tmp/scan_errors.txt 2>/dev/null; then
  echo "::group::Error: Found hard placeholder patterns"
  cat /tmp/scan_errors.txt
  echo "::endgroup::"
  echo "::error::Hard placeholder(s) detected (see group above)."
  errs=1
else
  echo "[scan] no hard placeholders found"
fi

# Scan for warnings
if grep -RIn -- "${files[@]}" -E "$WARN_PAT" >/tmp/scan_warnings.txt 2>/dev/null; then
  echo "::group::Warning: Found TODO/FIXME"
  cat /tmp/scan_warnings.txt
  echo "::endgroup::"
  echo "::warning::Found TODO/FIXME comments (non-blocking)."
else
  echo "[scan] no TODO/FIXME found"
fi

if [ "$errs" -ne 0 ]; then
  exit 1
fi

echo "[scan] done."
