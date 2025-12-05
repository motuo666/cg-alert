// mail-gateway.js
// 简单的邮件网关：给 /send-digest 提供发信能力

const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());

// 和 Cloudflare cg-alert-digest 里的 MAIL_GATEWAY_KEY 一致
const API_KEY = process.env.MAIL_GATEWAY_KEY;

// SMTP / 发件配置：按你实际用的邮箱服务来填
const SMTP_HOST = process.env.SMTP_HOST || "smtp.zoho.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || "587"); // Zoho: 587 (STARTTLS)
const SMTP_USER = process.env.SMTP_USER; // 比如 alerts@cg-alert.com
const SMTP_PASS = process.env.SMTP_PASS; // 这个账号的密码/应用专用密码
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;

// 一些启动时的提醒，方便你在 Render 日志里看到
if (!API_KEY) {
  console.warn("[MAIL-GW] WARN: MAIL_GATEWAY_KEY not set");
}
if (!SMTP_USER || !SMTP_PASS) {
  console.warn("[MAIL-GW] WARN: SMTP_USER/SMTP_PASS not fully set");
}

// 创建 SMTP 连接
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // 465 = implicit TLS; 587 = STARTTLS
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

// 健康检查
app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// digest 专用接口：Cloudflare 会 POST 到这里
app.post("/send-digest", async (req, res) => {
  const key = req.header("X-Api-Key") || "";
  if (!API_KEY || key !== API_KEY) {
    console.warn("[MAIL-GW] forbidden: bad api key");
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const { to, subject, text, html } = req.body || {};
  if (!to || !subject || (!text && !html)) {
    return res
      .status(400)
      .json({ ok: false, error: "missing to/subject/body" });
  }
  if (!SMTP_USER || !SMTP_PASS) {
    console.error("[MAIL-GW] smtp_not_configured");
    return res
      .status(500)
      .json({ ok: false, error: "smtp_not_configured" });
  }

  try {
    const info = await transporter.sendMail({
      from: MAIL_FROM,
      to,
      subject,
      text,
      html,
    });

    console.log("[MAIL-GW] mail sent", info.messageId, "to", to);
    // ✅ 不再 testOnly，表示真的发了
    return res.json({ ok: true });
  } catch (err) {
    console.error("[MAIL-GW] sendMail failed", err);
    return res.status(500).json({
      ok: false,
      error: "send_failed",
      detail: err && err.message ? err.message : String(err),
    });
  }
});

// 启动服务（Render 会注入 PORT）
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[MAIL-GW] listening on ${port}`);
});
