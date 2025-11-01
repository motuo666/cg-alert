#!/usr/bin/env bash
set -euo pipefail
missing=0
need(){ local k="$1"; local v="${!k:-}"; if [[ -z "$v" ]]; then echo "::error::Missing $k"; missing=1; fi; }
# Vars
need SITE_ORIGIN
need INTAKE_FORM_URL
need STRIPE_LINK_PORTFOLIO
need MAIL_FROM
need MAIL_POSTAL_ADDRESS
# SMTP
need SMTP_HOST
need SMTP_PORT
need SMTP_USER
need SMTP_PASS
# IMAP
need IMAP_HOST
need IMAP_PORT
need IMAP_USER
need IMAP_PASS
# Cloudflare
need CF_ACCOUNT_ID
need KV_NAMESPACE_ID
need CF_API_TOKEN
# Optional (warn only)
if [[ -z "${STRIPE_WEBHOOK_SECRET:-}" ]]; then echo "::warning::STRIPE_WEBHOOK_SECRET not set"; fi
exit $missing
