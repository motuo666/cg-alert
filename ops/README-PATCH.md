# Ops Patch Notes

- Cloudflare Worker `lead-gateway/` (CTA intake) added.
- `ops/values.env` filled with provided IDs.
- `scripts/acceptance_check.js` normalized to generate `artifacts/acceptance.md` and PASS line.
- Health: https://lead-gateway.manningtopps.workers.dev/health
- Test lead intake:
  curl -X POST https://lead-gateway.manningtopps.workers.dev/lead -H 'content-type: application/json' -d '{"email":"test@acme.com","name":"Acme"}'
