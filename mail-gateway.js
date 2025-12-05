// mail-gateway.js
// CG Alert 邮件网关：Cloudflare digest -> 这里 -> SMTP
// 默认 test 模式（只打日志，不发信），等你想正式发邮件时，开启 ENABLE_SMTP_SEND 即可。

const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());

// ---------- 配置 & 环境变量 ----------

// 和 Cloudflare cg-alert-digest 里的 MAIL_GATEWAY_KEY 一致
const API_KEY = process.env.MAIL_GATEWAY_KEY;

// 是否真的通过 SMTP 发信：
// - 不设置 / 不是 "true" => 只 test，不发信（返回 { ok: true, testOnly: true }）
// - 设置 ENABLE_SMTP_SEND="true" => 真正走 SMTP
const ENABLE_SMTP_SEND = process.env.ENABLE_SMTP_SEND === "true";

// SMTP / 发件配置（等你要真发信时再配）
// 示例：Zoho -> SMTP_HOST=smtp.zoho.com, SMTP_PORT=587
const SMTP_HOST = process.env.SMTP_HOST || "smtp.zoho.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER; // 比如 alerts@cg-alert.com
const SMTP_PASS = process.env.SMTP_PASS; // 密码/应用专用密码
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;

// 启动时打一点提示，方便看 Render 日志
console.log("[MAIL-GW] starting mail gateway");
console.log("[MAIL-GW] ENABLE_SMTP_SEND =", ENABLE_SMTP_SEND);

if (!API_KEY) {
  console.warn("[MAIL-GW] WARN: MAIL_GATEWAY_KEY not set (所有请求都会被 403)");
}
if (!SMTP_USER || !SMTP_PASS) {
  console.warn("[MAIL-GW] WARN: SMTP_USER/SMTP_PASS not fully set (真发信模式下会失败)");
}

// ---------- SMTP transporter（只有真发信需要） ----------

let transporter = null;

if (ENABLE_SMTP_SEND && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  transporter
    .verify()
    .then(() => {
      console.log("[MAIL-GW] SMTP connection verified");
    })
    .catch((err) => {
      console.error("[MAIL-GW] SMTP verify failed:", err.message || err);
    });
}

// ---------- 路由 ----------

// 健康检查
app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// digest / 通用发信入口：Cloudflare 会 POST 到这里
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

  // 默认：只 test，不发信（你现在就保持这个状态）
  if (!ENABLE_SMTP_SEND) {
    console.log(
      "[MAIL-GW] test mode: would send to",
      to,
      "subject=",
      JSON.stringify(subject),
    );
    return res.json({ ok: true, testOnly: true });
  }

  // 真发信模式：要求 SMTP 配置完整
  if (!transporter || !SMTP_USER || !SMTP_PASS) {
    console.error("[MAIL-GW] smtp_not_configured in ENABLE_SMTP_SEND=true mode");
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
    return res.json({ ok: true });
  } catch (err) {
    console.error("[MAIL-GW] sendMail failed:", err.message || err);
    return res.status(500).json({
      ok: false,
      error: "send_failed",
      detail: err && err.message ? err.message : String(err),
    });
  }
});

// ---------- 启动服务（Render 会注入 PORT） ----------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[MAIL-GW] listening on ${port}`);
});
