#!/usr/bin/env bash
set -euo pipefail
: "${GH_OWNER:?missing}"
: "${GH_REPO:?missing}"
: "${GH_TOKEN:?missing}"

payload='{"event_type":"stripe_paid","client_payload":{"email":"demo+paid@cg-alert.com","company":"DemoCo","tier":"Portfolio","cadence":"weekly","vendors":["zoom.us","atlassian.com"]}}'
curl -sS -X POST "https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches" \
  -H "Authorization: token ${GH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -d "${payload}"
echo "OK"
