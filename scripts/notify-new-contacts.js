// scripts/notify-new-contacts.js
//
// 运行逻辑：
// 1. 拉 KV keys 前缀 lead: 和 sale:
// 2. 对于 emailed:false 的记录，发邮件
// 3. 调 /mark_sent 标记已发送

const nodemailer = require("nodemailer");
const fetch = require("node-fetch");

// 从环境变量读配置（我们会在 GitHub Action 那边传进来）
const {
  CF_ACCOUNT_ID,
  KV_NAMESPACE_ID,
  CF_API_TOKEN,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  ADMIN_TOKEN,
  WORKER_URL, // 例如 https://lead-gateway.manningtopps.workers.dev
} = process.env;

// 通过 Cloudflare KV REST API 列 key
async function listKeys(prefix) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys?prefix=${encodeURIComponent(prefix)}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
    },
  });
  const json = await resp.json();
  if (!json.success) throw new Error("KV list failed " + JSON.stringify(json));
  return json.result || [];
}

async function getValue(keyName) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(keyName)}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
    },
  });
  if (resp.status === 404) return null;
  return JSON.parse(await resp.text());
}

async function markSent(keyName) {
  const resp = await fetch(`${WORKER_URL}/mark_sent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": ADMIN_TOKEN,
    },
    body: JSON.stringify({ key: keyName }),
  });
  if (!resp.ok) throw new Error("mark_sent failed " + resp.status);
}

// 建 SMTP 传输 (Zoho)
function buildTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,          // smtp.zoho.com
    port: parseInt(SMTP_PORT),// 465
    secure: true,             // 465需要true，587会是false+TLS
    auth: {
      user: SMTP_USER,        // ops@cg-alert.com
      pass: SMTP_PASS,        // Zoho的密码/应用密码
    },
  });
}

async function sendEmail(to, subject, text) {
  const transporter = buildTransport();
  await transporter.sendMail({
    from: SMTP_USER, // 看起来就是你ops@cg-alert.com在发
    to,
    subject,
    text,
  });
}

async function processLeadOrSale(keyName, obj) {
  if (obj.emailed) return;

  if (obj.type === "lead") {
    // 线索确认邮件
    if (!obj.contactEmail) return;
    const msg = [
      `We got your request.`,
      ``,
      `How this works:`,
      `1. We monitor the vendors you care about (pricing / SLA / liability / DPA / subprocessors).`,
      `2. We send timestamped evidence + escalation language you can paste directly into renewal.`,
      `3. Fully async. No calls.`,
      ``,
      `You listed: ${obj.vendors || "(no vendors yet)"}`,
      ``,
      `— CG Alert`,
    ].join("\n");

    await sendEmail(
      obj.contactEmail,
      "CG Alert intake received",
      msg
    );
  }

  if (obj.type === "sale") {
    // 成交欢迎邮件
    if (!obj.purchaserEmail) return;
    const msg = [
      `You're in.`,
      ``,
      `We'll send timestamped evidence of pricing / SLA / liability / DPA / subprocessor changes,`,
      `plus escalation language you can paste directly into renewal.`,
      ``,
      `If you want us to watch specific vendors (Portfolio covers up to 3 you name), just reply with the vendor names.`,
      ``,
      `— CG Alert`,
    ].join("\n");

    await sendEmail(
      obj.purchaserEmail,
      "CG Alert access",
      msg
    );
  }

  // 标成已发，防止重复发
  await markSent(keyName);
}

async function main() {
  // 取全部lead:*和sale:*
  const leadKeys = await listKeys("lead:");
  const saleKeys = await listKeys("sale:");

  for (const k of [...leadKeys, ...saleKeys]) {
    const obj = await getValue(k.name);
    if (!obj) continue;
    await processLeadOrSale(k.name, obj);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
