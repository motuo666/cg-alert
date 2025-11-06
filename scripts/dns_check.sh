#!/usr/bin/env bash
set -euo pipefail

domain="${MAIL_FROM##*@}"
domain="${domain,,}"
[ -z "${domain}" ] && echo "MAIL_FROM not set, cannot infer domain" && echo "ok=false" >> "$GITHUB_OUTPUT" && exit 0

digcmd() { dig +short TXT "$1" 2>/dev/null | tr -d '\r' | tr -d '"'; }

spf="$(digcmd "$domain")"
dmarc="$(digcmd "_dmarc.$domain")"
dkim_selector="${DKIM_SELECTOR:-default}"
dkim="$(digcmd "${dkim_selector}._domainkey.${domain}")"

ok_spf=false; ok_dmarc=false; ok_dkim=false

[[ "$spf" =~ v=spf1 ]] && ok_spf=true
if [[ "$dmarc" =~ v=DMARC1 ]]; then
  if [[ "$dmarc" =~ p=quarantine ]] || [[ "$dmarc" =~ p=reject ]]; then ok_dmarc=true; fi
fi
[[ "$dkim" =~ v=DKIM1 ]] && ok_dkim=true

overall=false
if $ok_spf && $ok_dmarc && $ok_dkim; then overall=true; fi

echo "domain=$domain" >> "$GITHUB_OUTPUT"
echo "ok_spf=$ok_spf" >> "$GITHUB_OUTPUT"
echo "ok_dmarc=$ok_dmarc" >> "$GITHUB_OUTPUT"
echo "ok_dkim=$ok_dkim" >> "$GITHUB_OUTPUT"
echo "ok=$overall" >> "$GITHUB_OUTPUT"

{
  echo "### Email DNS check for **$domain**"
  echo ""
  echo "- SPF: $ok_spf"
  echo "- DMARC(p=quarantine/reject): $ok_dmarc"
  echo "- DKIM(${dkim_selector}): $ok_dkim"
} >> "$GITHUB_STEP_SUMMARY"
