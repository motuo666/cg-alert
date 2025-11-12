#!/usr/bin/env bash
set -euo pipefail
# This script is optional: it shows how to generate the scan step line with allowlist
awk '
  BEGIN{}
' .github/workflows/final-acceptance.yml >/dev/null 2>&1 || true
