# Security Policy
- 不在代码库中存储明文秘钥。
- 所有秘钥通过环境变量或密钥管理（GitHub Secrets, Cloudflare Secrets）。
- 邮件发送必须遵守 SPF / DKIM / DMARC 策略。
- 对 Stripe / 邮件 / Worker 日志进行最小化记录，避免敏感数据泄露。
