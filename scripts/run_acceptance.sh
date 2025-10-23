#!/usr/bin/env bash
set -euo pipefail

red(){ echo -e "\033[31m✗ $*\033[0m"; }
grn(){ echo -e "\033[32m✓ $*\033[0m"; }
ylw(){ echo -e "\033[33m! $*\033[0m"; }

fail(){ red "$1"; exit 1; }

need_files=(
  "worker/lead-gateway.js"
  ".github/workflows/buildwith-import.yml"
  ".github/workflows/outbound.yml"
  "scripts/import_buildwith.js"
  "scripts/send_outbound.js"
  "config/email_templates/outbound"
)

for f in "${need_files[@]}"; do
  [ -e "$f" ] || fail "缺文件: $f"
done
grn "文件存在性 OK"

# 关键路由
grep -Eq "/import" worker/lead-gateway.js || fail "lead-gateway 缺少 /import 路由"
grep -Eq "/u"      worker/lead-gateway.js || fail "lead-gateway 缺少 /u 退订路由"
grep -Eq "/stripe" worker/lead-gateway.js || fail "lead-gateway 缺少 /stripe Webhook"
grep -Eq "/lead"   worker/lead-gateway.js || fail "lead-gateway 缺少 /lead 表单路由"
grn "Worker 路由齐全"

# Import 鉴权
grep -Eq "x-obs-key|OBS_KEY" worker/lead-gateway.js scripts/import_buildwith.js \
  || fail "/import 未做 x-obs-key 鉴权"
grn "/import 鉴权 OK"

# 退订 HMAC
grep -Eq "UNSUB_HMAC_SECRET|crypto|Hmac" worker/lead-gateway.js \
  || fail "退订 token 没用 HMAC 校验"
grn "退订 HMAC 校验 OK"

# Stripe 校验
grep -Eq "STRIPE_WEBHOOK_SECRET" worker/lead-gateway.js \
  || fail "Stripe Webhook 未校验签名"
grn "Stripe Webhook 签名校验 OK"

# UTM + lid 兜底
grep -RIl "buy.stripe.com" public scripts config || ylw "未在代码中找到 buy.stripe.com（你若走页面注入也可）"
grep -RIl "lid=" public scripts config || ylw "未搜索到 lid=，确认前端已在点击时注入 lid"
grn "UTM/lid 注入检查（如有黄标，手动点页面验证）"

# 模板退订与 lid
grep -RIl "u?u=" config/email_templates/outbound >/dev/null \
  || fail "外拓模板缺退订链接参数 ?u="
grep -RIl "lid" config/email_templates/outbound >/dev/null \
  || ylw "模板里未显式包含 lid（如果由前端 JS 注入可忽略）"
grn "外拓模板校验 OK"

# Workflows 并发与计划
grep -Eq "concurrency:" .github/workflows/outbound.yml \
  || fail "outbound.yml 缺 concurrency 防并发"
grep -Eq "on:|workflow_dispatch|schedule" .github/workflows/outbound.yml \
  || fail "outbound.yml 未配置触发"
grep -Eq "concurrency:" .github/workflows/buildwith-import.yml \
  || ylw "buildwith-import.yml 无 concurrency（建议加）"
grn "Workflows 结构 OK"

# 变量名对齐（仅做静态提示）
need_secrets=( "UNSUB_HMAC_SECRET" "STRIPE_WEBHOOK_SECRET" "CF_API_TOKEN" "SMTP_HOST" "SMTP_USER" "SMTP_PASS" "MAIL_FROM" "OBS_KEY" )
for s in "${need_secrets[@]}"; do
  grep -RIl "$s" . >/dev/null || ylw "仓库未引用 $s（可能在 GitHub Secrets 中）"
done
grn "Secrets/Variables 命名静态检查完成"

grn "静态验收通过 ✅（进入 E2E 烟囱测试）"
