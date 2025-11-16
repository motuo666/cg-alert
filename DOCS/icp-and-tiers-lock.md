# ICP & Tiers Lock (Autopilot Reference)

- ICP: B2B teams that rely on multiple SaaS vendors (CRM / Billing / Analytics / Collaboration / Security, etc.) and need to know when those vendors change pricing or legal terms, primarily for product, revenue, and renewal leverage.
- Tier structure (public, self-serve):

  - Free: $0 — strictly limited, evaluation-only experience. Used as the main traffic and content funnel, not for production monitoring.
  - Pro: $499/year — up to 5 vendors. Individual / very small team intelligence tool. Weekly alerts and dashboards. Self-serve via Stripe Checkout.
  - Business: $1,499/year — up to 15 vendors. Team intelligence and collaboration. Daily/weekly alerts, email summaries, dashboards, and export. Self-serve via Stripe Checkout.
  - Audit: $2,988/year — up to 25 vendors. Automated audit & governance: PDF reports, multi-user, and 3-year data retention. Self-serve via Stripe Checkout (no traditional enterprise sales).

- Self-serve & automation rules:

  - All paid tiers are purchased via Stripe Checkout.
  - There are no manual sales demos, custom invoice workflows, or contract redlines.
  - Any higher-value, one-off deal must still respect the self-serve, no-redlines policy, even if invoiced separately.

Before changing plans or positioning, update this file first and then sync the following:

- data/pricing-links.json
- data/pricing.json
- pricing/config.json
- config/ci/config.json
- config/templates/outreach_*.html
- /public/pricing.html
- /index.html (hero & meta copy if needed)
- /terms/index.html (Subscription & automation clauses)
