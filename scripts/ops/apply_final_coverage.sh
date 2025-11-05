#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
root="cg-alert-main/.github/workflows"
changed=0

patch_outreach() {
  local f="$1"
  echo "patching $f"
  # concurrency
  if ! grep -q '^concurrency:' "$f"; then
    awk 'BEGIN{done=0} /^jobs:/{if(!done){print "concurrency:\n  group: outreach-${{ github.workflow }}\n  cancel-in-progress: true"; done=1} } {print}' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
  # guard adds
  sed -i \
    -e 's/git add -A out/if [ -d out ]; then git add -A out; fi/g' \
    -e 's/git add out/if [ -d out ]; then git add out; fi/g' \
    -e 's/git add data\/suppressions.csv/if [ -f data\/suppressions.csv ]; then git add data\/suppressions.csv; fi/g' \
    "$f"
  # UNSUB precedence
  if grep -q 'UNSUB_ORIGIN:' "$f"; then
    sed -i -E 's/UNSUB_ORIGIN:\s*["'\'']?\$\{\{\s*vars\.UNSUB_ORIGIN\s*\}\}["'\'']?/UNSUB_ORIGIN: ${{ vars.UNSUB_ORIGIN || secrets.UNSUB_ORIGIN }}/g' "$f"
  fi
  # Slack failure notify
  if ! grep -q 'Slack on failure' "$f"; then
    cat >> "$f" <<'EOF'

  - name: Slack on failure
    if: failure()
    env:
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL || vars.SLACK_WEBHOOK_URL }}
    run: |
      set -e
      jq -n --arg t "❌ ${GITHUB_WORKFLOW} failed • run=${GITHUB_RUN_ID}" '{text:$t}' \
      | curl -sS -H 'Content-Type: application/json' -d @- "$SLACK_WEBHOOK_URL" >/dev/null
EOF
  fi
  changed=1
}

for f in "$root"/daily-outreach*.yml; do
  [ -f "$f" ] && patch_outreach "$f" || true
done

# guard non-critical scripts
guard_script() {
  local f="$1" p="$2"
  if grep -q "$p" "$f"; then
    if ! grep -q "missing, skip" "$f"; then
      sed -i "/node[[:space:]]\+$(echo "$p" | sed 's/\//\\\//g')/i\\
  - name: Guard missing script\\
    run: |\\
      set -e\\
      [ -f $p ] || { echo \"missing, skip\"; exit 0; }
" "$f"
      changed=1
    fi
  fi
}
for f in "$root"/*.yml; do
  [ -f "$f" ] || continue
  guard_script "$f" "scripts/stabilize/fix_canonical.js"
  guard_script "$f" "scripts/stabilize/merge_redirects.js"
  guard_script "$f" "scripts/build_outreach_from_brand.js"
  guard_script "$f" "scripts/patch_pricing_ui.js"
  guard_script "$f" "scripts/qa/assets_check.js"
  guard_script "$f" "scripts/weekly_report.js"
done

echo "done. changed=$changed"
