\
#!/usr/bin/env bash
#
# scripts/run_acceptance.sh
#
# 单人维护版最终验收脚本 (P0 BASELINE)
#
# 目标：一键告诉你“现在能不能关灯跑赚钱”
# - 检查关键文件/工作流是否存在
# - 检查 funnel (/buy/portfolio redirect) 是否到位
# - 检查 check-secrets.yml 里是否引用了所有强制 Secrets/Vars
#
# 用法：
#   bash scripts/run_acceptance.sh
#
set -euo pipefail

red(){ echo -e "\033[31m✗ $*\033[0m"; }
grn(){ echo -e "\033[32m✓ $*\033[0m"; }
ylw(){ echo -e "\033[33m! $*\033[0m"; }
fail(){ red "$1"; exit 1; }

# 1. 关键路径都必须存在
need_paths=(
  "lead-gateway/src/index.js"
  ".github/workflows/outbound.yml"
  ".github/workflows/outreach-triggered.yml"
  ".github/workflows/suppression-sync.yml"
  ".github/workflows/bounce-sweep.yml"
  "scripts/poll_inbox.js"
  "scripts/send_outbound.js"
  "scripts/send_triggered.js"
  "scripts/promote-intakes.js"
  "data/leads.csv"
  "data/intakes.csv"
  "data/customers.csv"
  "_redirects"
  "index.html"
)

for p in "${need_paths[@]}"; do
  if [ ! -f "$p" ]; then
    fail "缺文件: $p"
  fi
done
grn "关键路径存在 OK"

# 2. check-secrets.yml 要包含我们统一的必需 Secrets 名称
must_envs=(
  SITE_ORIGIN
  INTAKE_FORM_URL
  STRIPE_LINK_PORTFOLIO
  SMTP_HOST
  SMTP_PORT
  SMTP_USER
  SMTP_PASS
  MAIL_FROM
  SLACK_WEBHOOK_URL
  IMAP_HOST
  IMAP_PORT
  IMAP_USER
  IMAP_PASS
  CF_API_TOKEN
  STRIPE_WEBHOOK_SECRET
  UNSUB_HMAC_SECRET
)

for name in "${must_envs[@]}"; do
  if ! grep -q "$name" ".github/workflows/check-secrets.yml"; then
    ylw "check-secrets.yml 未检测 $name"
  fi
done
grn "Secrets 命名一致性检查完成（黄色提示代表需要补）"

# 3. /buy/portfolio redirect 必须在 _redirects 里存在，否则用户无法直接刷卡
grep -Eq "/buy/portfolio" _redirects || fail "_redirects 里缺 /buy/portfolio → Stripe Payment Link"
grn "购买入口 (/buy/portfolio) 存在 OK"

# 4. 基础漏斗 CTA 关键词存在
grep -RIl "Buy Portfolio" index.html public/index.html 2>/dev/null \
  || ylw "落地页里找不到 'Buy Portfolio' CTA (检查 index.html 是否被你改坏)"

# 5. 基本通过
echo
grn "ACCEPTANCE PASS (基础版) — 代表可以开始跑流量+外发，但不代表完全无风险。"
