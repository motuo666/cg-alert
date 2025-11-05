#!/usr/bin/env bash
set -euo pipefail
bash cg-alert-main/scripts/ops/apply_final_coverage.sh
bash cg-alert-main/scripts/ops/apply_entitlement_guard.sh
bash cg-alert-main/scripts/ops/ensure_redirects.sh
echo "All patches applied."
