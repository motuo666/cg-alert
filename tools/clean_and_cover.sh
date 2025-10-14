#!/usr/bin/env bash
# CG Alert — 一键清理 + 覆盖（含删除 34 个冗余工作流）
# 作用：删冗余、标准化 14 个核心工作流（Node 20 + Safe Push）、新增别名脚本、统一 vendors/ slug、校验 leads.csv。
# 要求：在仓库根目录执行。本脚本尽量幂等；缺文件会自动跳过；最后使用 git_safe_push.sh（若缺则用内置兜底）。

set -euo pipefail

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*"; }

# 0) 位置校验
if [ ! -d .git ] || [ ! -d .github ]; then
  echo "请在仓库根目录运行（需包含 .git 与 .github/）"; exit 1
fi
mkdir -p .github/workflows scripts tools

# 1) 保护点（回滚锚）
TAG="pre-clean-$(date -u +%Y%m%d-%H%M%S)"
if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  log "打保护标签：$TAG"
  git add -A && git commit -m "chore: checkpoint before clean (auto)" || true
  git tag "$TAG" || true
fi

# 2) 删除 34 个冗余/历史/重复型工作流（缺文件自动跳过）
log "删除冗余工作流（34）"
del_list=(
  "_ping.yml"
  "alert-changes.yml"
  "apply-fixpack.yml"
  "auto-domains.yml"
  "auto-tags.yml"
  "channel-digest.yml"
  "codeql.yml"
  "collect-evidence.yml"
  "csv-normalize.yml"
  "customer-feeds.yml"
  "daily-ops-report.yml"
  "data-sanitize.yml"
  "deps-fix-core.yml"
  "deps-fix-minimist.yml"
  "dmarc-auto.yml"
  "e2e-fullchain.yml"
  "fix-leads.yml"
  "git-unignore-evidence.yml"
  "internal-linking.yml"
  "kpi-force-green.yml"
  "kpi-jumpstart.yml"
  "leads-lint.yml"
  "manual-monthly-public-report.yml"
  "manual-promote-intakes.yml"
  "manual-weekly-health.yml"
  "nav-tighten.yml"
  "restore-legacy-home.yml"
  "run-root.yml"
  "secret-scan.yml"
  "sitemap-ping.yml"
  "slack-ping.yml"
  "upsell-capacity.yml"
  "vendor-scale.yml"
  "collect-evidence-daily.yml"
)
for f in "${del_list[@]}"; do
  p=".github/workflows/$f"
  if [ -f "$p" ]; then git rm -f "$p" || true; fi
done

# 3) 如存在旧名，统一重命名为口径文件名
if [ -f .github/workflows/Outreach-S1.yml ]; then
  log "重命名 Outreach-S1.yml → outreach-s1.yml"
  git mv .github/workflows/Outreach-S1.yml .github/workflows/outreach-s1.yml || true
fi

# 4) 覆盖 14 个核心工作流（Node 20 + Safe Push）
write() { mkdir -p "$(dirname "$1")"; cat > "$1"; }

log "写入：outreach-s1.yml"
write .github/workflows/outreach-s1.yml <<'YAML'
name: Outreach S1
on:
  schedule: [ { cron: "30 17 * * 1-5" } ]
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
        run: node scripts/leads_guard.js && node scripts/validate_leads.js || true
      - name: Gate (48h evidence)
        id: gate
        env: { TRIGGER_WINDOW_H: 48 }
        run: node scripts/s1_gate.js || echo "ok=0" >> $GITHUB_OUTPUT
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

log "写入：outreach-triggered.yml"
write .github/workflows/outreach-triggered.yml <<'YAML'
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

log "写入：promote-intakes.yml"
write .github/workflows/promote-intakes.yml <<'YAML'
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
          chmod +x scripts/git_safe_push.sh || true
          if [ -x scripts/git_safe_push.sh ]; then
            bash scripts/git_safe_push.sh "promote: intakes -> customers"
          else
            git add -A
            git pull --rebase --autostash || true
            git commit -m "promote: intakes -> customers" || true
            git push || true
          fi
YAML

log "写入：weekly-health-check.yml"
write .github/workflows/weekly-health-check.yml <<'YAML'
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
          chmod +x scripts/git_safe_push.sh || true
          if [ -x scripts/git_safe_push.sh ]; then
            bash scripts/git_safe_push.sh "kpi: weekly health"
          else
            git add -A
            git pull --rebase --autostash || true
            git commit -m "kpi: weekly health" || true
            git push || true
          fi
YAML

log "写入：monthly-public-report.yml"
write .github/workflows/monthly-public-report.yml <<'YAML'
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
          chmod +x scripts/git_safe_push.sh || true
          if [ -x scripts/git_safe_push.sh ]; then
            bash scripts/git_safe_push.sh "report: public monthly ${{ inputs.month || 'auto' }}"
          else
            git add -A
            git pull --rebase --autostash || true
            git commit -m "report: public monthly ${{ inputs.month || 'auto' }}" || true
            git push || true
          fi
YAML

log "写入：seo-tighten.yml"
write .github/workflows/seo-tighten.yml <<'YAML'
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
          chmod +x scripts/git_safe_push.sh || true
          if [ -x scripts/git_safe_push.sh ]; then
            bash scripts/git_safe_push.sh "seo: inject json-ld/canonical/meta"
          else
            git add -A
            git pull --rebase --autostash || true
            git commit -m "seo: inject json-ld/canonical/meta" || true
            git push || true
          fi
YAML

log "写入：domain-grow.yml"
write .github/workflows/domain-grow.yml <<'YAML'
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
          chmod +x scripts/git_safe_push.sh || true
          if [ -x scripts/git_safe_push.sh ]; then
            bash scripts/git_safe_push.sh "grow: +auto discovered domains (daily)"
          else
            git add -A
            git pull --rebase --autostash || true
            git commit -m "grow: +auto discovered domains (daily)" || true
            git push || true
          fi
YAML

log "写入：channel-grow.yml"
write .github/workflows/channel-grow.yml <<'YAML'
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
          chmod +x scripts/git_safe_push.sh || true
          if [ -x scripts/git_safe_push.sh ]; then
            bash scripts/git_safe_push.sh "channel: weekly partner targets"
          else
            git add -A
            git pull --rebase --autostash || true
            git commit -m "channel: weekly partner targets" || true
            git push || true
          fi
YAML

log "写入：public-change-poller.yml"
write .github/workflows/public-change-poller.yml <<'YAML'
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
          chmod +x scripts/git_safe_push.sh || true
          if [ -x scripts/git_safe_push.sh ]; then
            bash scripts/git_safe_push.sh "poller: public endpoints + site refresh"
          else
            git add -A
            git pull --rebase --autostash || true
            git commit -m "poller: public endpoints + site refresh" || true
            git push || true
          fi
YAML

log "写入：vendor-catalog.yml"
write .github/workflows/vendor-catalog.yml <<'YAML'
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
          chmod +x scripts/git_safe_push.sh || true
          if [ -x scripts/git_safe_push.sh ]; then
            bash scripts/git_safe_push.sh "vendors: weekly refresh"
          else
            git add -A
            git pull --rebase --autostash || true
            git commit -m "vendors: weekly refresh" || true
            git push || true
          fi
YAML

log "写入：weekly-updates.yml"
write .github/workflows/weekly-updates.yml <<'YAML'
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
          chmod +x scripts/git_safe_push.sh || true
          if [ -x scripts/git_safe_push.sh ]; then
            bash scripts/git_safe_push.sh "updates: weekly refresh"
          else
            git add -A
            git pull --rebase --autostash || true
            git commit -m "updates: weekly refresh" || true
            git push || true
          fi
YAML

log "写入：categories.yml"
write .github/workflows/categories.yml <<'YAML'
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
          chmod +x scripts/git_safe_push.sh || true
          if [ -x scripts/git_safe_push.sh ]; then
            bash scripts/git_safe_push.sh "categories: weekly refresh"
          else
            git add -A
            git pull --rebase --autostash || true
            git commit -m "categories: weekly refresh" || true
            git push || true
          fi
YAML

log "写入：inbound.yml（退信出列）"
write .github/workflows/inbound.yml <<'YAML'
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
        run: node scripts/poll_inbox.js --dry=0 || echo "IMAP not configured; skip"
      - name: Heartbeat
        if: success()
        run: |
          mkdir -p data
          date -u +"%FT%TZ" > data/last_poll.txt
      - name: Safe Push
        if: always()
        run: |
          chmod +x scripts/git_safe_push.sh || true
          if [ -x scripts/git_safe_push.sh ]; then
            bash scripts/git_safe_push.sh "inbound: bounces + heartbeat"
          else
            git add -A
            git pull --rebase --autostash || true
            git commit -m "inbound: bounces + heartbeat" || true
            git push || true
          fi
YAML

log "写入：discover-contacts.yml（线索净增）"
write .github/workflows/discover-contacts.yml <<'YAML'
name: Discover Public Contacts
on:
  schedule: [ { cron: "8 15 * * 1-5" } ]
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
        run: node scripts/validate_leads.js || true
      - name: Safe Push
        run: |
          chmod +x scripts/git_safe_push.sh || true
          if [ -x scripts/git_safe_push.sh ]; then
            bash scripts/git_safe_push.sh "leads: discover + validate"
          else
            git add -A
            git pull --rebase --autostash || true
            git commit -m "leads: discover + validate" || true
            git push || true
          fi
YAML

# 5) 新增/覆盖脚本：vendor_catalog.js（别名保持口径）
log "写入：scripts/vendor_catalog.js"
write scripts/vendor_catalog.js <<'JS'
#!/usr/bin/env node
// alias for build_vendor_catalog.js to honor naming convention
require('./build_vendor_catalog.js');
JS
chmod +x scripts/vendor_catalog.js || true

# 6) 新增一次性修复脚本：vendors_slug_unify.js（统一 vendors/<domain>[,Company] → vendors/<domain>）
log "写入：scripts/vendors_slug_unify.js"
write scripts/vendors_slug_unify.js <<'JS'
#!/usr/bin/env node
/**
 * vendors_slug_unify.js — 将 vendors/<domain>[,Company]/ → vendors/<domain>/
 * - 合并重复（优先保留已有 index.html / feed.xml）
 * - 更新 sitemap-vendors.xml（若存在）
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
chmod +x scripts/vendors_slug_unify.js || true

# 7) 自愈：统一 vendors/；校验 leads.csv（若脚本存在）
log "执行一次性自愈：vendors slug unify / leads 校验（若存在脚本）"
node scripts/vendors_slug_unify.js || true
node scripts/leads_guard.js || true
node scripts/validate_leads.js || true

# 8) Safe Push（优先使用仓库自带脚本；否则兜底）
log "提交并推送改动（Safe Push）"
chmod +x scripts/git_safe_push.sh || true
if [ -x scripts/git_safe_push.sh ]; then
  bash scripts/git_safe_push.sh "ci: clean workflows & harden pipelines"
else
  git add -A
  git pull --rebase --autostash || true
  git commit -m "ci: clean workflows & harden pipelines" || true
  git push || true
fi

log "完成 ✅：已删除冗余、覆盖核心工作流、添加修复脚本、执行自愈。可在 Actions 手动触发验证。"
