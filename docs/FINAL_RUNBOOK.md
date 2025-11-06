# CG Alert Final Runbook

## One-time
1. Upload this patch to repo root (cg-alert-main/), allow overwrite.
2. Git commit & push.
3. Fill Actions Secrets/Vars: SMTP_*, IMAP_*, SLACK_WEBHOOK_URL, CF_API_TOKEN, STRIPE_WEBHOOK_SECRET, and SITE/INTAKE/STRIPE links.

## Verify (Actions → Run workflow)
1) Target Discovery Autopilot → expect updates in data/seed_domains.txt & data/leads.csv
2) Public Change Poller → evidence generated
3) Build Content / SEO Sitemap Ping / Site QA
4) Repo Sanitizer (optional) → remove placeholder files

## Steady-state
- Discovery (6h) → Poller (6h) → Render+RSS+Sitemap → Slack/Email.
- To tighten TTD: change poller cron to */3.
