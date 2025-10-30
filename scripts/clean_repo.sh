#!/usr/bin/env bash
set -e
git ls-files | grep -E '\.(bak|~)$' | xargs -r git rm
git rm -r artifacts 2>/dev/null || true
git rm -r netlify 2>/dev/null || true
git rm -f public/_redirects public/CNAME 2>/dev/null || true
git commit -m "chore: clean legacy/backup files" || true
