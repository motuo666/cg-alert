# ICP & Tiers Lock (Autopilot Reference)

- ICP: B2B companies that have experienced or expect material changes to key SaaS vendors (CRM / Billing / Analytics / Collaboration, etc.) in pricing, legal terms, or privacy.
- Primary tiers:
  - Portfolio: $2,988/year, self-serve, via Stripe Checkout.
  - Business: $6,000/year, self-serve, via Stripe Checkout.
  - Enterprise: $18,000+/year, via intake form (/intake/) and manual confirmation.

All outreach templates and automation scripts assume the above ICP and three tiers are fixed.
Before changing plans or positioning, update this file and then sync the following:

- data/pricing-links.json
- pricing/config.json
- config/ci/config.json
- config/templates/outreach_*.html
