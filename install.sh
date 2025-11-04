#!/usr/bin/env bash
set -euo pipefail
unzip -o cg-alert-kop-cleanup-and-site-fix.zip -d .
git add -A
git commit -m "site: cleanup + headers/robots/404 + reports ui + mailto replacer" || true
git push || true
echo "Installed. Next:"
echo "  bash scripts/audit/clean_kop.sh --dry"
echo "  bash scripts/audit/clean_kop.sh --apply"
echo "  node scripts/fix/replace_mailto.js && git add -A && git commit -m 'fix: nav mailto -> /enterprise/' && git push"
