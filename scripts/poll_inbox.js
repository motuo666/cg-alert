\
#!/usr/bin/env node
/**
 * scripts/poll_inbox.js
 *
 * 功能：
 *   - 连接 IMAP (7天窗口)
 *   - 识别退信 / 投诉
 *   - 把 (邮箱,原因,时间) 追加写入 data/bounces.csv
 *
 * 关键点：
 *   - 如果 IMAP_* 没配，直接退出 0（不算错误），不会让 workflow fail
 *   - 输出格式兼容 suppression-sync / leads_guard 等后续脚本
 *
 * 依赖：
 *   "imapflow" 必须在 package.json dependencies 里
 *
 * 需要的 Secrets/Vars (GitHub Actions -> Secrets 或 Vars):
 *   IMAP_HOST
 *   IMAP_PORT (默认 993)
 *   IMAP_USER
 *   IMAP_PASS
 */

const fs = require("fs");
const path = require("path");
const { ImapFlow } = require("imapflow");

const {
  IMAP_HOST,
  IMAP_PORT = "993",
  IMAP_USER,
  IMAP_PASS,
} = process.env;

if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) {
  console.log("[poll_inbox] IMAP not configured; skip");
  process.exit(0);
}

(async () => {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: Number(IMAP_PORT || "993"),
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
  });

  await client.connect();
  await client.mailboxOpen("INBOX");

  // lookback: 7 days
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const seq = await client.search({ since });

  for await (const msg of client.fetch(seq, {
    envelope: true,
    source: true,
  })) {
    const raw = msg.source.toString();

    // basic bounce / complaint matcher
    const isBounce = /(Delivery Status Notification|Mail delivery failed|Undeliverable|bounce|complaint)/i.test(
      raw
    );
    if (!isBounce) continue;

    // try to capture final/original recipient
    let rcpt = "";
    let m =
      raw.match(/Final-Recipient:\s*rfc822;\s*([^\s\r\n]+)/i) ||
      raw.match(/Original-Recipient:\s*rfc822;\s*([^\s\r\n]+)/i);
    if (m && m[1]) {
      rcpt = m[1].trim().toLowerCase();
    }

    // capture short diagnostic reason
    let reason = "";
    m = raw.match(/Diagnostic-Code:\s*([^\r\n]+)/i);
    if (m && m[1]) {
      reason = m[1].trim();
    }
    if (!reason) {
      // fallback to "Status: 5.x.x <text>"
      m = raw.match(/Status:\s*([0-9.]+)\s*([^\r\n]*)/i);
      if (m) {
        reason = (m[0] || "").trim();
      }
    }

    const ts = new Date(msg.envelope.date || Date.now()).toISOString();
    const line =
      [
        rcpt || "unknown",
        (reason || "bounce").replace(/,/g, ";"),
        ts,
      ].join(",") + "\n";

    fs.mkdirSync("data", { recursive: true });
    fs.appendFileSync(path.join("data", "bounces.csv"), line);
    console.log("[poll_inbox] added", line.trim());
  }

  await client.logout();
})().catch((err) => {
  console.error("[poll_inbox] ERR", err && err.stack ? err.stack : err);
  // don't crash the CI/job hard
  process.exit(0);
});
