#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

files=(.github/workflows/daily-outreach-*.yml .github/workflows/daily-outreach-*.yaml)
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  if grep -q "Pick AB template (email)" "$f"; then
    echo "[skip] already wired: $f"
    continue
  fi
  echo "[patch] wiring templates into $f"
  tmp="$(mktemp)"
  awk '
    BEGIN{injected=0}
    {
      print $0
      if (!injected && $0 ~ /uses: actions\/checkout@/) {
        print "      - name: Pick AB template (email)"
        print "        id: picktpl_email"
        print "        run: |"
        print "          node scripts/ops/pick_template.js --channel email --theme default --persona \"${PERSONA:-default}\" --date \"$(date +%F)\""
        print "        shell: bash"
        print ""
        print "      - name: Pick AB template (slack)"
        print "        id: picktpl_slack"
        print "        run: |"
        print "          node scripts/ops/pick_template.js --channel slack --theme default --persona \"${PERSONA:-default}\" --date \"$(date +%F)\""
        print "        shell: bash"
        print ""
        injected=1
      }
    }
  ' "$f" > "$tmp"
  mv "$tmp" "$f"
done

echo "[ok] template wiring done."
