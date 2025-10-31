#!/usr/bin/env bash
set -euo pipefail
red(){ printf "\e[31m%s\e[0m\n" "$1"; }
yel(){ printf "\e[33m%s\e[0m\n" "$1"; }
grn(){ printf "\e[32m%s\e[0m\n" "$1"; }
missing=0
must_have(){ local key="$1"; local val="${2:-}"; if [ -z "${val:-}" ]; then red "✗ missing: $key"; missing=$((missing+1)); else grn "✓ $key"; fi; }
nice_to_have(){ local key="$1"; local val="${2:-}"; if [ -z "${val:-}" ]; then yel "• (optional) $key is empty"; else grn "• (optional) $key present"; fi; }
must_have SITE_ORIGIN "${SITE_ORIGIN:-}"
must_have MAIL_FROM "${MAIL_FROM:-}"
must_have MAIL_POSTAL_ADDRESS "${MAIL_POSTAL_ADDRESS:-}"
must_have STRIPE_LINK_RENEWAL_DESK "${STRIPE_LINK_RENEWAL_DESK:-}"
must_have STRIPE_LINK_PORTFOLIO    "${STRIPE_LINK_PORTFOLIO:-}"
must_have STRIPE_LINK_COMPLIANCE   "${STRIPE_LINK_COMPLIANCE:-}"
must_have INTAKE_FORM_URL          "${INTAKE_FORM_URL:-}"
must_have UNSUB_HMAC_SECRET        "${UNSUB_HMAC_SECRET:-}"
must_have SMTP_HOST "${SMTP_HOST:-}"
must_have SMTP_PORT "${SMTP_PORT:-}"
must_have SMTP_USER "${SMTP_USER:-}"
must_have SMTP_PASS "${SMTP_PASS:-}"
must_have STRIPE_WEBHOOK_SECRET "${STRIPE_WEBHOOK_SECRET:-}"
nice_to_have ENRICH_API_TOKEN "${ENRICH_API_TOKEN:-}"
nice_to_have TARGET_DISCOVERY_API_TOKEN "${TARGET_DISCOVERY_API_TOKEN:-}"
if [ "${missing}" -gt 0 ]; then red "✗ Missing ${missing} required variables/secrets"; exit 1; else grn "✓ All required variables/secrets are set"; fi
