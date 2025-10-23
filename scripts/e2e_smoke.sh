#!/usr/bin/env bash
set -euo pipefail

# 必填：按你仓库变量实际值填
WORKER_URL="$https://lead-gateway.manningtopps.workers.dev"
CF_ACCOUNT_ID="$76aef9eabaaeeb291d751140630ee1a1"
KV_NAMESPACE_ID="$b214daf070d54636a05bc281ccdb0b11"
CF_API_TOKEN="$4HvvS43xA9uMJz9hrCLC4FFVLyth0uaM46YvB0GN"

echo "1) 未授权 import 应 403"
curl -s -o /dev/null -w "%{http_code}\n" -XPOST "$WORKER_URL/import" -H 'content-type: application/json' -d '[]' | grep -q 403

echo "2) 授权导入 2 条"
cat > /tmp/buildwith-mini.json <<'JSON'
[
  {"email":"bw_shopify_1@example.com","domain":"ex-shop1.com","company":"ExShop1","tech":["Shopify","Cloudflare"]},
  {"email":"bw_wp_1@example.com","domain":"ex-wp1.com","company":"ExWP1","tech":["WordPress","WooCommerce"]}
]
JSON
curl -s "$WORKER_URL/import" -H "x-obs-key: ${OBS_KEY}" -H "content-type: application/json" --data-binary @/tmp/buildwith-mini.json | grep -E '"imported":\s*2'

echo "3) 队列是否落 KV（看最近 keys 数）"
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/storage/kv/namespaces/$KV_NAMESPACE_ID/keys?prefix=dripq:outbound:" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result | length' | awk '{ if ($1<2) exit 1 }'

echo "4) 触发 outbound（也可等 schedule）"
# 这里用 GitHub Actions UI 手动 Run 一次；发信需看邮箱收件箱

echo "5) 退订：点邮件尾部 /u?u=token 链接，后再跑 outbound，确认该地址不再发"

echo "6) 归因闭环：从邮件 CTA 进站，URL 带 utm_* & lid=；点击任意 buy.stripe.com，URL 仍带 lid。用 Stripe 测试支付后，KV 该邮箱出现 purchase.plan/amount/period_* 字段。"
