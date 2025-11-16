# Project Overview

## Built With
- Cloudflare Workers
- Node.js automation pipeline
- Stripe / SMTP / IMAP integrations

## What it does
- 全自动化获客（面向 6k 美元中客单，多客户）
- 全自动化交付（支付 → 开通 → 对账）
- 全自动化更新 & 定期报告

## How to run (high level)
- 本地：安装依赖，配置 .env，本地 dry-run
- 生产：通过 CI 部署到 Cloudflare Workers / KV / Queues
- 监控：使用 health 脚本 + GitHub Actions 定时体检
