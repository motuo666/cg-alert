-- D1 schema for Stripe webhook idempotency tracking
-- Run this against the `cg-alert-prod` D1 database before enabling the
-- updated stripe-dispatcher Worker.

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
