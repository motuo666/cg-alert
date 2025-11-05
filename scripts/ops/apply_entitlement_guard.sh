#!/usr/bin/env bash
set -euo pipefail

f="cg-alert-main/scripts/customer_digest.js"
[ -f "$f" ] || { echo "::warning::$f not found, skip entitlement patch"; exit 0; }

# 1) Inject RULE + normalizeEntitlement() once
if ! grep -q "normalizeEntitlement" "$f"; then
  awk '
    BEGIN{inserted=0}
    /const LIMIT =/ && !inserted {
      print $0
      print ""
      print "// ---- ENTITLEMENT RULES (auto-injected) ----"
      print "const RULE = {"
      print "  portfolio:  { vendors: 25, cadence: [\"weekly\"],          channels: 1 },"
      print "  business:   { vendors: 50, cadence: [\"daily\",\"weekly\"], channels: 2 },"
      print "  enterprise: { vendors: 200, cadence: [\"daily\",\"weekly\"], channels: 2 },"
      print "};"
      print "function normalizeEntitlement(c){"
      print "  const plan = (c.plan||\"portfolio\").toLowerCase();"
      print "  const R = RULE[plan] || RULE.portfolio;"
      print "  let cadence = (c.cadence|| (plan===\"business\"?\"daily\":\"weekly\")).toLowerCase();"
      print "  if (!R.cadence.includes(cadence)) cadence = R.cadence[0];"
      print "  let vendors = (c.vendors||\"\").split(/[ ,;]+/).filter(Boolean).slice(0, R.vendors);"
      print "  return { plan, cadence, vendors, R };"
      print "}"
      print "// ---- ENTITLEMENT RULES END ----"
      inserted=1; next
    }
    { print $0 }
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
fi

# 2) Use normalized values
if grep -q "const cadence = (c.cadence||'weekly').toLowerCase();" "$f"; then
  sed -i "s/const cadence = (c.cadence||'weekly').toLowerCase();/const E = normalizeEntitlement(c); const cadence = E.cadence;/" "$f"
fi
if grep -q "const vendors = (c.vendors||'').split" "$f"; then
  sed -i "s/const vendors = (c.vendors||''.*/const vendors = E.vendors;/" "$f"
fi

echo "entitlement patch applied to $f"
