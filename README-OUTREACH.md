# CG Alert — Outreach Final (2025-11-01)
What’s inside:
- scripts/send_triggered.js — hardened outreach sender (see comments)
- scripts/compute_send_limit.js — gradual ramp for SEND_LIMIT
- .github/workflows/daily-outreach.yml — daily 02:00 UTC
- lead-gateway/src/index.js — /unsub handler (CF Worker)
- scripts/kv_unsub_sync.js — sync unsub from KV to repo
- .github/workflows/unsub-sync.yml — daily 03:10 UTC
- data/seeds.csv — optional seed inboxes (excluded from limit)
