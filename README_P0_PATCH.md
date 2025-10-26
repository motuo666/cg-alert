\
CG Alert - P0 稳定化补丁 (3322 线)
=================================

目的
----
把现在仓库拉到“可以开始冲收入”的最低安全线，而不是还停在半断电/半成品。

这个补丁里包含 4 个核心东西：
1. scripts/repair_pages.js        —— 扫 vendors / reports / updates 里的坏 HTML，把 `<head$1>` / `...` 修干净
2. scripts/poll_inbox.js          —— 干净版 IMAP 退信收集器，配合 suppression-sync 用，防止域名被拉黑
3. scripts/run_acceptance.sh      —— 最小验收脚本，判断 funnel / secrets / 关键工作流有没有到位
4. .github/workflows/stabilize.yml —— 定时每小时跑一次 repair_pages.js + 自动 commit/push，做“自愈巡检”

另外附上删除清单 (delete-list.txt) 和统一 Secrets/Vars 列表。

使用步骤（一次性到位）
----------------------

1. 手动删除旧/冲突文件：
   - 仓库根目录的 `wrangler.toml`
     解释：这是旧的 Worker 声明（main="src/worker.js"）。现在的真实 Worker 在 `lead-gateway/` 目录下，
     有自己独立的 wrangler.toml 和 `src/index.js`。留两个会误导任何自动检查脚本/巡检脚本。

   暂时 **不要删 public/** 目录。
   理由：一些脚本（比如 patch_cta_forms.js）还会假设 public/ 结构；而且 Pages/Actions 构建 dist/ 的逻辑
   目前仍然依赖它。我们后面可以再合并 public/ 和根目录版本，但现在先别动，先跑通现金流。

2. 把补丁里的文件合并进你的仓库：
   - 覆盖 `scripts/poll_inbox.js`
   - 覆盖/替换 `scripts/run_acceptance.sh`
   - 新增   `scripts/repair_pages.js`
   - 新增   `.github/workflows/stabilize.yml`
   - 新增   `README_P0_PATCH.md`
   - 新增   `delete-list.txt`

   然后 git add / commit / push。

3. 在 GitHub 仓库 → Settings → Secrets and variables 里，确保下面这些名字全部存在
   （有些是 Secrets，有些可以是 Repository Variables；保持名字完全一致，后续 workflow 会用）：

   - SITE_ORIGIN                (vars)  例: https://www.cg-alert.com
   - INTAKE_FORM_URL            (vars)  Google Form /lead 表单入口
   - STRIPE_LINK_PORTFOLIO      (vars)  Stripe Payment Link (Portfolio $2,988/yr)
   - SMTP_HOST                  (secrets)
   - SMTP_PORT                  (secrets)
   - SMTP_USER                  (secrets)
   - SMTP_PASS                  (secrets)
   - MAIL_FROM                  (vars or secrets)  发件人地址, 例 "CG Alert <alerts@cg-alert.com>"
   - SLACK_WEBHOOK_URL          (secrets) 用于告警/健康检查
   - IMAP_HOST                  (secrets) 退信邮箱 IMAP 主机
   - IMAP_PORT                  (secrets) 通常 993
   - IMAP_USER                  (secrets)
   - IMAP_PASS                  (secrets)
   - CF_API_TOKEN               (secrets) Cloudflare API token (用于 lead-gateway KV / DNS 修补等操作)
   - STRIPE_WEBHOOK_SECRET      (secrets) Stripe webhook 签名校验
   - UNSUB_HMAC_SECRET          (secrets) 用于生成安全退订 URL 的 HMAC
   - (可选) WORKER_URL          (vars)   例: https://lead-gateway.manningtopps.workers.dev

   统一命名是关键，否则 check-secrets.yml / bounce-sweep.yml / suppression-sync.yml / outreach-triggered.yml
   这些工作流要么直接报错停掉，要么发不出邮件，要么抑制列表不同步 → 最后域名信誉爆炸。

4. 打开 Actions 手动跑两样东西：
   a) "Check Secrets"（或等价健康检查工作流）  
   b) "Stabilize P0 (repair pages + commit)"（本补丁提供的 stabilize.yml）

   如果 stabilize.yml 成功合并修正 `<head$1>` / `...`，你的 vendors/* / updates/* / reports/* 页面
   就会是干净 HTML，不再像半成品，这直接影响成交转化。

5. 本地或在 Codespaces / dev 容器里跑：
   ```bash
   bash scripts/run_acceptance.sh
   ```
   这个脚本会快速告诉你：
   - 购买入口 (/buy/portfolio) 有没有在 `_redirects`
   - outreach-triggered / outbound / suppression-sync 等关键工作流是不是存在
   - check-secrets.yml 是否在校验所有必须的 Secrets/Vars
   绿灯后，说明“可以买 + 能发冷启动 + 能自动抑制 + 能持续抓退信”。

到这一步后发生什么？
---------------------
达到下面标准，才算“准生产可以冲 400k/yr”：

- 访客从任意入口页（vendors/xxx, reports/xxxx, updates/xxxx, who-uses/ 等）都能在首屏 CTA 里：
  - 点 "Buy Portfolio · $2,988/yr" → 302 到 STRIPE_LINK_PORTFOLIO（刷卡）
  - 点 "Enable alerts" / "Request Enterprise" → 302 到 INTAKE_FORM_URL /lead-gateway Worker
  没有 404 / AccessDenied / XML error。

- `outreach-triggered.yml` / `outbound.yml` 能正常跑：
  它们会用最新证据卡 + 真实痛点，自动给采购/法务/RevOps 发冷启动邮件。
  这是真正带钱回来的引擎。

- `bounce-sweep.yml` + `suppression-sync.yml` + 这个补丁里的新版 poll_inbox.js
  会把退信/投诉自动写进 data/bounces.csv，并且回灌 leads.csv 状态，防止你继续乱轰滥炸同一个垃圾地址。
  这决定你的域名信誉能不能撑住，否则你根本没法放量发。

- `repair_pages.js` + `stabilize.yml`
  会把 `<head$1>` / `...` 这类脏标记自动清理并 push 回 main。
  这个就是“无人值守的自愈”，不需要你手工去修 100+ 个 vendors/xxx.html。

删除清单（需要你手工删）
-------------------------
见 delete-list.txt：
- `wrangler.toml` (仓库根目录的这一份，旧的、指向不存在的 src/worker.js)
  真实 Worker 现在在 `lead-gateway/` 目录下，有自己的 wrangler.toml 和 src/index.js，
  以后所有脚本都要指向那个。

暂时 **不要** 删除：
- `public/` 目录  
  理由：build / CTA 注入脚本仍在引用它，dist/ 构建流程也假设它存在。等后面全站头部/CTA 完全统一后，
  再把 public/ 折叠进一个唯一的站点源，那个可以作为 P1/P2 的清理。

到这里为止，你的系统具备什么能力？
----------------------------------
1. 把供应商公开页面的变更证据（pricing, ToS, DPA, subprocessors, status 等）做成带时间戳和差异对比的 evidence 卡片；
2. 用这些证据给“谁会真正付钱的人”（采购/法务/RevOps）发冷启动外发；
3. 自动收集退信/投诉并从 leads 里剔除，保护域名信誉；
4. 页面/CTA/redirect 全部能带来真实付费 (Stripe) 或至少留下合规线索 (Google Form / lead-gateway)；
5. 自动巡检、自动修复，把脏页面清干净并 push 回 main，让站点一直像成品，而不是像测试服。

这五条打通后，才是真正的 BuildWith 型一人公司打法：流量→证据→冷启动→成交→复利，全闭环。

这就是你冲年入 400k/yr 的最小可行闭环。
