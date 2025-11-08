#!/usr/bin/env bash
set -euo pipefail

domain="${1:-}"
if [[ -z "$domain" ]]; then
  echo "usage: $0 domain" >&2
  exit 2
fi

spf=$(dig +short TXT "$domain" | tr -d '"' | grep -qi 'v=spf1' && echo true || echo false)
dmarc=$(dig +short TXT "_dmarc.$domain" | tr -d '"' | grep -qi 'v=dmarc1' && echo true || echo false)
dk=false
for s in default s1 s2 k1 google selector1 selector2; do
  if dig +short TXT "$s._domainkey.$domain" | tr -d '"' | grep -qi 'v=dkim1'; then dk=true; break; fi
done

dns_ok=false
if [[ "$spf" == true && "$dmarc" == true && "$dk" == true ]]; then dns_ok=true; fi

echo "spf=$spf"
echo "dkim=$dk"
echo "dmarc=$dmarc"
echo "dns_ok=$dns_ok"
