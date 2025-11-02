#!/usr/bin/env bash
set -euo pipefail
need(){ local n="$1"; local v="${!n:-}"; [[ -z "$v" ]] && { echo "::error::Missing required env: $n"; MISSING=1; } || true; }
MISSING=0
# vars
need SITE_ORIGIN
need MAIL_FROM
need MAIL_POSTAL_ADDRESS
need STRIPE_LINK_PORTFOLIO
need STRIPE_LINK_BUSINESS
need INTAKE_FORM_URL
# secrets sending
need UNSUB_HMAC_SECRET
need SMTP_HOST
need SMTP_PORT
need SMTP_USER
need SMTP_PASS
# infra
need CF_ACCOUNT_ID
need KV_NAMESPACE_ID
need CF_API_TOKEN
# imap
need IMAP_HOST
need IMAP_PORT
need IMAP_USER
need IMAP_PASS
# webhook optional
if [[ -z "${STRIPE_WEBHOOK_SECRET:-}" ]]; then echo "::warning::STRIPE_WEBHOOK_SECRET not set; Stripe auto-booking off"; fi
[[ $MISSING -eq 1 ]] && exit 1 || echo "all required env/secrets present"
