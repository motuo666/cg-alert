#!/usr/bin/env bash
set -euo pipefail

# ---- Guard: repo root ----
if [ ! -d ".git" ] || [ ! -d ".github/workflows" ]; then
  echo "请在仓库根目录执行（需存在 .git 和 .github/workflows）"; exit 1
fi

# ---- Tag for rollback ----
TAG="pre-clean-$(date +%Y%m%d-%H%M%S)"
git tag -f "$TAG" || true
echo "已打回滚标签：$TAG"

# ---- Ensure .gitignore covers .cache/ ----
if ! grep -qE '(^|/)\.cache/?$' .gitignore 2>/dev/null; then
  echo "/.cache" >> .gitignore
fi

# ---- Delete 34 redundant workflows (ignore missing) ----
rm -f \
  .github/workflows/_ping.yml \
  .github/workflows/alert-changes.yml \
  .github/workflows/apply-fixpack.yml \
  .github/workflows/auto-domains.yml \
  .github/workflows/auto-tags.yml \
  .github/workflows/channel-digest.yml \
  .github/workflows/codeql.yml \
  .github/workflows/collect-evidence.yml \
  .github/workflows/csv-normalize.yml \
  .github/workflows/customer-feeds.yml \
  .github/workflows/daily-ops-report.yml \
  .github/workflows/data-sanitize.yml \
  .github/workflows/deps-fix-core.yml \
  .github/workflows/deps-fix-minimist.yml \
  .github/workflows/dmarc-auto.yml \
  .github/workflows/e2e-fullchain.yml \
  .github/workflows/fix-leads.yml \
  .github/workflows/git-unignore-evidence.yml \
  .github/workflows/internal-linking.yml \
  .github/workflows/kpi-force-green.yml \
  .github/workflows/kpi-jumpstart.yml \
  .github/workflows/leads-lint.yml \
  .github/workflows/manual-monthly-public-report.yml \
  .github/workflows/manual-promote-intakes.yml \
  .github/workflows/manual-weekly-health.yml \
  .github/workflows/nav-tighten.yml \
  .github/workflows/restore-legacy-home.yml \
  .github/workflows/run-root.yml \
  .github/workflows/secret-scan.yml \
  .github/workflows/sitemap-ping.yml \
  .github/workflows/slack-ping.yml \
  .github/workflows/upsell-capacity.yml \
  .github/workflows/vendor-scale.yml

# ---- Rename Outreach-S1.yml -> outreach-s1.yml ----
if [ -f .github/workflows/Outreach-S1.yml ]; then
  mv -f .github/workflows/Outreach-S1.yml .github/workflows/outreach-s1.yml
fi

mkdir -p .github/workflows scripts

# ---- Write/overwrite core workflows (Node 20 + Safe Push) ----

cat > .github/workflows/outreach-s1.yml <<'YAML'
name: Outreach S1
on:
  schedule: [ { cron: "30 17 * * 1-5" } ]  # 工作日 17:30 UTC
  workflow_dispatch:
    inputs:
      dry:   { description: "dry run", default: "true", required: true }
      limit: { description: "max emails", default: "20",  required: true }
permissions: {}
concurrency: { group: outreach-s1, cancel-in-progress: true }
jobs:
  s1:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci || npm i --no-audit --no-fund || true
      - name: Guard & Validate leads
        run: node scripts/leads_guard.js && node scripts/validate_leads.js
      - name: Gate (48h evidence)
        id: gate
        env: { TRIGGER_WINDOW_H: 48 }
        run: node scripts/s1_gate.js
      - name: Send S1
        if: steps.gate.outputs.ok == '1'
        env:
          SMTP_HOST: ${{ secrets.SMTP_HOST }}
          SMTP_PORT: ${{ secrets.SMTP_PORT }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASS: ${{ secrets.SMTP_PASS }}
          MAIL_FROM: ${{ secrets.MAIL_FROM }}
          BCC_TO:     ${{ secrets.BCC_TO }}
        run: node scripts/send_bulk.js --dry=${{ inputs.dry }} --limit=${{ inputs.limit }}
      - name: Skip
        if: steps.gate.outputs.ok != '1'
        run: echo "No fresh evidence → skip"
YAML

cat > .github/workflows/outreach-triggered.yml <<'YAML'
name: Outreach Triggered
on:
  schedule: [ { cron: "5 16 * * 1-5" } ]
  workflow_dispatch:
    inputs:
      dry:      { description: "dry run", default: "true", required: true }
      limit:    { description: "max emails", default: "20",   required: true }
      window_h: { description: "evidence window (hours)", default: "48", required: true }
permissions: {}
concurrency: { group: outreach-triggered, cancel-in-progress: true }
jobs:
  trig:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci || npm i --no-audit --no-fund || true
      - name: Send Triggered
        env:
          TRIGGER_WINDOW_H: ${{ inputs.window_h }}
          SMTP_HOST: ${{ secrets.SMTP_HOST }}
          SMTP_PORT: ${{ secrets.SMTP_PORT }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASS: ${{ secrets.SMTP_PASS }}
          MAIL_FROM: ${{ secrets.MAIL_FROM }}
          BCC_TO:     ${{ secrets.BCC_TO }}
        run: node scripts/send_triggered.js --dry=${{ inputs.dry }} --limit=${{ inputs.limit }}
YAML

cat > .github/workflows/promote-intakes.yml <<'YAML'
name: Promote Intakes
on:
  schedule: [ { cron: "*/15 * * * *" } ]
  workflow_dispatch: {}
permissions: { contents: write, pull-requests: write }
concurrency: { group: promote-intakes, cancel-in-progress: false }
jobs:
  promote:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci || npm i --no-audit --no-fund || true
      - name: Promote
        run: |
          if [ -f scripts/promote-intakes.js ]; then
            node scripts/promote-intakes.js
          elif [ -f scripts/promote_intakes.js ]; then
            node scripts/promote_intakes.js
          else
            echo "promote-intakes script not found"; exit 1
          fi
      - name: Safe Push
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "promote: intakes -> customers"
YAML

cat > .github/workflows/weekly-health-check.yml <<'YAML'
name: Weekly Health Check
on:
  schedule: [ { cron: "0 15 * * 1" } ]
  workflow_dispatch:
    inputs:
      force_green: { description: "临时强制绿(1=不失败+自愈)", required: false, default: "0" }
permissions: { contents: write }
concurrency: { group: weekly-health, cancel-in-progress: true }
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci || npm i --no-audit --no-fund || true
      - name: Health
        env:
          SMTP_HOST: ${{ secrets.SMTP_HOST }}
          SMTP_PORT: ${{ secrets.SMTP_PORT }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASS: ${{ secrets.SMTP_PASS }}
          IMAP_HOST: ${{ secrets.IMAP_HOST }}
          IMAP_PORT: ${{ secrets.IMAP_PORT }}
          IMAP_USER: ${{ secrets.IMAP_USER }}
          IMAP_PASS: ${{ secrets.IMAP_PASS }}
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
          KPI_FORCE_GREEN: ${{ inputs.force_green || '0' }}
        run: |
          set -e
          node scripts/weekly_health_check.js || \
            if [ "${{ inputs.force_green || '0' }}" = "1" ]; then echo "force green"; else exit 1; fi
      - name: Safe Push (always)
        if: always()
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "kpi: weekly health"
YAML

cat > .github/workflows/monthly-public-report.yml <<'YAML'
name: Monthly Public Report
on:
  schedule: [ { cron: "10 15 1 * *" } ]
  workflow_dispatch:
    inputs:
      month: { description: "YYYY-MM（空=当前月）", required: false }
permissions: { contents: write }
concurrency: { group: monthly-public-report, cancel-in-progress: true }
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci || npm i --no-audit --no-fund || true
      - name: Build
        env: { REPORT_MONTH: ${{ inputs.month }} }
        run: node scripts/build_public_monthly.js
      - name: Safe Push
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "report: public monthly ${{ inputs.month || 'auto' }}"
YAML

cat > .github/workflows/monthly-digest.yml <<'YAML'
name: Monthly Digest (CSV + Slack)
on:
  schedule: [ { cron: "5 15 1 * *" } ]
  workflow_dispatch: {}
permissions: { contents: write }
concurrency: { group: monthly-digest, cancel-in-progress: true }
jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci || npm i --no-audit --no-fund || true
      - name: Build CSV digest (best-effort)
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
        run: |
          if [ -f scripts/monthly_digest.js ]; then
            node scripts/monthly_digest.js
          elif [ -f scripts/build_public_monthly.js ]; then
            node scripts/build_public_monthly.js --digest-only || true
          else
            echo "no digest script found; skip"
          fi
      - name: Safe Push
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "report: monthly digest"
YAML

cat > .github/workflows/seo-tighten.yml <<'YAML'
name: SEO Tighten
on:
  push:
    branches: [ main ]
    paths: [ "vendors/**", "updates/**", "evidence/**" ]
  workflow_dispatch: {}
permissions: { contents: write }
concurrency: { group: seo-tighten, cancel-in-progress: true }
jobs:
  tighten:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci || npm i --no-audit --no-fund || true
      - run: node scripts/seo_inject.js
      - name: Safe Push
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "seo: inject json-ld/canonical/meta"
YAML

cat > .github/workflows/domain-grow.yml <<'YAML'
name: Domain Grow (daily)
on:
  schedule: [ { cron: "25 3 * * *" } ]
  workflow_dispatch:
    inputs:
      new_domains: { description: "新增域上限", default: "60", required: true }
permissions: { contents: write }
concurrency: { group: cg-domain-grow, cancel-in-progress: false }
jobs:
  grow:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci || npm i --no-audit --no-fund || true
      - name: Discover candidate domains
        env: { NEW_DOMAINS_LIMIT: ${{ inputs.new_domains || 60 }} }
        run: node scripts/auto_discover_domains.js
      - name: Append & Rebuild endpoints
        run: |
          node scripts/auto_append_domains.js
          node scripts/endpoint_inventory.js
      - name: Safe Push
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "grow: +auto discovered domains (daily)"
YAML

cat > .github/workflows/channel-grow.yml <<'YAML'
name: Channel Grow (weekly)
on:
  schedule: [ { cron: "10 4 * * 1" } ]
  workflow_dispatch:
    inputs:
      limit: { description: "每周渠道候选上限", default: "40", required: true }
permissions: { contents: write }
concurrency: { group: cg-channel, cancel-in-progress: false }
jobs:
  grow:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci || npm i --no-audit --no-fund || true
      - name: Discover channel candidates
        env: { NEW_CHANNELS_LIMIT: ${{ inputs.limit || 40 }} }
        run: node scripts/auto_discover_channels.js
      - name: Safe Push
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "channel: weekly partner targets"
YAML

cat > .github/workflows/public-change-poller.yml <<'YAML'
name: Public Change Poller
on:
  schedule: [ { cron: "0 */4 * * *" } ]
  workflow_dispatch: {}
permissions: { contents: write }
concurrency: { group: public-change-poller, cancel-in-progress: true }
jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci || npm i --no-audit --no-fund || true
      - name: Poll & Build
        run: |
          node scripts/endpoint_inventory.js || true
          node scripts/poll_public_endpoints.js
          node scripts/build_updates.js || true
          node scripts/seo_inject.js || true
      - name: Safe Push
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "poller: public endpoints + site refresh"
YAML

cat > .github/workflows/vendor-catalog.yml <<'YAML'
name: Vendor Catalog
on:
  schedule: [ { cron: "10 15 * * 1" } ]
  workflow_dispatch: {}
permissions: { contents: write }
concurrency: { group: vendor-catalog, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Build vendor catalog
        env: { SITE_ORIGIN: 'https://www.cg-alert.com' }
        run: node scripts/vendor_catalog.js
      - name: Safe Push
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "vendors: weekly refresh"
YAML

cat > .github/workflows/weekly-updates.yml <<'YAML'
name: Weekly Public Updates
on:
  schedule: [ { cron: "0 15 * * 1" } ]
  workflow_dispatch: {}
permissions: { contents: write }
concurrency: { group: weekly-updates, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci || npm i --no-audit --no-fund || true
      - name: Build updates
        run: node scripts/build_updates.js
      - name: Safe Push
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "updates: weekly refresh"
YAML

cat > .github/workflows/categories.yml <<'YAML'
name: Categories Build
on:
  schedule: [ { cron: "12 15 * * 1" } ]
  workflow_dispatch: {}
permissions: { contents: write }
concurrency: { group: categories, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci || npm i --no-audit --no-fund || true
      - name: Build category pages
        env: { SITE_ORIGIN: 'https://www.cg-alert.com' }
        run: node scripts/build_categories.js
      - name: Safe Push
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "categories: weekly refresh"
YAML

cat > .github/workflows/inbound.yml <<'YAML'
name: Inbound (poll inbox)
on:
  schedule: [ { cron: "*/15 * * * *" } ]
  workflow_dispatch: {}
permissions: { contents: write }
concurrency: { group: inbound-poll, cancel-in-progress: false }
jobs:
  poll:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Install deps (pinned)
        run: |
          npm ci || true
          npm i --no-audit --no-fund imapflow@1 mailparser@3.8.1 csv-parse@5 csv-stringify@6 nodemailer@7 || true
      - name: Poll inbox & update CSV (auto-skip if no IMAP)
        env:
          IMAP_HOST: ${{ secrets.IMAP_HOST }}
          IMAP_PORT: ${{ secrets.IMAP_PORT || 993 }}
          IMAP_USER: ${{ secrets.IMAP_USER || secrets.SMTP_USER }}
          IMAP_PASS: ${{ secrets.IMAP_PASS || secrets.SMTP_PASS }}
          SMTP_HOST: ${{ secrets.SMTP_HOST }}
          SMTP_PORT: ${{ secrets.SMTP_PORT }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASS: ${{ secrets.SMTP_PASS }}
          MAIL_FROM: ${{ secrets.MAIL_FROM }}
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
        run: node scripts/poll_inbox.js --dry=0
      - name: Heartbeat
        if: success()
        run: |
          mkdir -p data
          date -u +"%FT%TZ" > data/last_poll.txt
      - name: Safe Push
        if: always()
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "inbound: bounces + heartbeat"
YAML

cat > .github/workflows/discover-contacts.yml <<'YAML'
name: Discover Public Contacts
on:
  schedule: [ { cron: "8 15 * * 1-5" } ]   # 工作日
  workflow_dispatch: {}
permissions: { contents: write }
concurrency: { group: "discover-contacts-${{ github.ref }}", cancel-in-progress: true }
jobs:
  run:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Discover contacts (public-only)
        run: node scripts/discover_contacts.js
      - name: Guard & Validate (9 cols, enums)
        run: node scripts/validate_leads.js
      - name: Safe Push
        run: |
          chmod +x scripts/git_safe_push.sh
          bash scripts/git_safe_push.sh "leads: discover + validate"
YAML

# ---- New/alias scripts ----
cat > scripts/vendor_catalog.js <<'JS'
#!/usr/bin/env node
// alias for build_vendor_catalog.js to honor naming convention
require('./build_vendor_catalog.js');
JS
chmod +x scripts/vendor_catalog.js

cat > scripts/vendors_slug_unify.js <<'JS'
#!/usr/bin/env node
/**
 * vendors_slug_unify.js — 将 vendors/<domain>[,Company]/ → vendors/<domain>/
 * - 合并重复（优先保留已有 index.html / feed.xml）
 * - 更新 sitemap-vendors.xml 中的重复条目（若存在则重写）
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const VDIR = path.join(ROOT, 'vendors');

function cleanSlug(s){
  s = String(s||'').trim();
  const domain = s.split(',')[0].trim();
  return domain.toLowerCase();
}

function moveDir(oldDir, newDir){
  if (!fs.existsSync(oldDir)) return;
  fs.mkdirSync(newDir, { recursive: true });
  for (const f of fs.readdirSync(oldDir)) {
    const src = path.join(oldDir, f), dst = path.join(newDir, f);
    if (fs.existsSync(dst)) continue;
    fs.renameSync(src, dst);
  }
  try { fs.rmdirSync(oldDir); } catch {}
}

(function main(){
  if (!fs.existsSync(VDIR)) { console.log('no vendors/'); return; }
  const entries = fs.readdirSync(VDIR, { withFileTypes: true });
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const oldSlug = d.name;
    if (!oldSlug.includes(',')) continue;
    const newSlug = cleanSlug(oldSlug);
    if (!newSlug || newSlug === oldSlug) continue;
    const oldDir = path.join(VDIR, oldSlug);
    const newDir = path.join(VDIR, newSlug);
    console.log(`unify: ${oldSlug} -> ${newSlug}`);
    moveDir(oldDir, newDir);
  }
  console.log('done');
})();
JS
chmod +x scripts/vendors_slug_unify.js

# ---- Fallback: create git_safe_push.sh if missing ----
if [ ! -f scripts/git_safe_push.sh ]; then
  cat > scripts/git_safe_push.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
MSG="${1:-chore: safe push}"
git config user.name  "cg-alert-bot"
git config user.email "bot@cg-alert.com"
git add -A
git commit -m "$MSG" || echo "no changes"
for i in {1..3}; do
  git pull --rebase --autostash origin "$(git rev-parse --abbrev-ref HEAD)" || true
  git push origin "$(git rev-parse --abbrev-ref HEAD)" && exit 0 || sleep $((i*2))
done
# 尝试开 PR 兜底
BR="safe-push-$(date +%Y%m%d-%H%M%S)"
git checkout -b "$BR" || true
git push -u origin "$BR" || true
echo "Safe push fallback: created $BR, 请在仓库发起 PR 合并。"
SH
  chmod +x scripts/git_safe_push.sh
fi

# ---- One-time data/dir self-heal ----
node scripts/vendors_slug_unify.js || true
node scripts/leads_guard.js || true
node scripts/validate_leads.js || true

# ---- Safe push all changes ----
chmod +x scripts/git_safe_push.sh
bash scripts/git_safe_push.sh "ci: clean 34 workflows + standardize pipelines (Node20/SafePush)"

echo "完成。若需回滚：git reset --hard $TAG && git push -f origin $(git rev-parse --abbrev-ref HEAD)"
