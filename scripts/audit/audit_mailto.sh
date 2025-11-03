#!/usr/bin/env bash
set -euo pipefail
if command -v rg >/dev/null 2>&1; then
  rg -n "mailto:" public || true
else
  grep -RIn "mailto:" public || true
fi
