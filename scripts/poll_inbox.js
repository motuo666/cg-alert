// scripts/poll_inbox.js  —  inbound handler (trials / unsubscribes / bounces)
// Robust版：Zoho IMAP + DSN(Bounce) 解析 + CSV 记录 + Slack 通知

const fs = require("fs");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

// ====== env ======
const IMAP_HOST = process.env.IMAP_HOST || "imap.zoho.com";
const IMAP_PORT = parseInt(process.env.IMAP_PORT || "993", 10);
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASS = process.env.IMAP_PASS;
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK || "";

// ====== utils ======
const nowIso = () => new Date().toISOString();
const ensureDir = (p) => fs.mkdirSync(path.dirname(p), { recursive: true });
function appendCsv(file, headers, rowObj) {
  ensureDir(file);
  const headerLine = headers.join(",") + "\n";
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    fs.writeFileSync(file, headerLine, "utf8");
  }
  const line = headers
    .map((h) => {
      let v = rowObj[h] == null ? "" : String(rowObj[h]);
      // 简单转义
      if (v.includes(",") || v.includes('"') || v.includes("\n")) {
        v = `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    })
    .join(",") + "\n";
  fs.appendFileSync(file, line, "utf8");
}

async function slack(text) {
  try {
    if (!SLACK_WEBHOOK) return;
    await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {}
}

// 解析 DSN (delivery-status) 文本块中的键值
function parseDsnBlock(txt) {
  const out = {};
  const lines = String(txt || "").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([\w-]+)\s*:\s*(.+)$/i);
    if (m) {
      out[m[1].toLowerCase()] = m[2];
    }
  }
  // 常见字段提取
  const finalRec = out["final-recipient"]; // e.g. "rfc822; user@example.com"
  const origRec = out["original-recipient"];
  const diag = out["diagnostic-code"];
  const action = out["action"]; // failed, delayed, delivered, relayed, expanded
  const status = out["status"]; // 5.1.1 等
  const mta = out["reporting-mta"];
  const pickAddr = (v) => {
    if (!v) return "";
    const m = v.match(/rfc822;\s*([^\s;]+)/i) || v.match(/<([^>]+)>/);
    return (m && m[1]) || "";
  };
  return {
    orig_recipient: pickAddr(origRec),
    final_recipient: pickAddr(finalRec),
    diagnostic_code: diag || "",
    dsn_action: action || "",
    dsn_status: status || "",
    reporting_mta: mta || "",
  };
}

// 从普通正文中兜底提取原收件人（有些退信不带 delivery-status 附件）
function guessTargetFromText(text) {
  if (!text) return "";
  let m =
    text.match(/Original-Recipient:\s*rfc822;\s*([^\s]+)/i) ||
    text.match(/Final-Recipient:\s*rfc822;\s*([^\s]+)/i) ||
    text.match(/Recipient:\s*<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/i) ||
    text.match(/To:\s*<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/i) ||
    text.match(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i);
  return (m && m[1]) || "";
}

function isLikelyBounce(fromAddr, subject, contentType, text) {
  const fromHit = /mailer-daemon|postmaster/i.test(fromAddr || "");
  const subjHit =
    /delivery status notification|undeliver|failure notice|mail delivery/i.test(
      subject || ""
    );
  const typeHit = /report-type=delivery-status/i.test(contentType || "");
  // 某些退信主题很随意，正文有 DSN 关键字也算
  const textHit = /Final-Recipient:|Diagnostic-Code:|Status: \d\.\d\.\d/.test(
    text || ""
  );
  return fromHit || subjHit || typeHit || textHit;
}

// ====== main ======
async function main() {
  if (!IMAP_USER || !IMAP_PASS) {
    console.error("IMAP creds missing");
    process.exit(1);
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
  });

  await client.connect();
  await client.mailboxOpen("INBOX");

  // 只拉未读；若要兜底，可改成 { seen: false } 或最近若干天
  const uids = await client.search({ seen: false }); // returns UID array

  let handled = 0,
    trials = 0,
    unsubs = 0,
    bounces = 0;

  for await (const msg of client.fetch(uids, {
    uid: true,
    source: true,
    envelope: true,
    bodyStructure: true,
  })) {
    try {
      const parsed = await simpleParser(msg.source);
      const fromAddr =
        (parsed.from && parsed.from.value && parsed.from.value[0]?.address) ||
        "";
      const subject = parsed.subject || "";
      const text = parsed.text || "";
      const contentType =
        (parsed.headers && parsed.headers.get("content-type")) || "";

      // —— 1) 退信（Bounce）优先处理
      if (isLikelyBounce(fromAddr, subject, contentType, text)) {
        // 优先从 delivery-status 附件提取
        let dsnInfo = {};
        const deliveryStatusPart =
          (parsed.attachments || []).find(
            (a) =>
              a.contentType &&
              a.contentType.toLowerCase().startsWith("message/delivery-status")
          ) ||
          null;
        if (deliveryStatusPart) {
          const dsnText = deliveryStatusPart.content.toString("utf8");
          dsnInfo = parseDsnBlock(dsnText);
        }
        // 兜底：正文里猜测目标收件人
        const guessed =
          dsnInfo.final_recipient ||
          dsnInfo.orig_recipient ||
          guessTargetFromText(text) ||
          "";

        const bounceRow = {
          ts: nowIso(),
          email: guessed || "", // 原目标收件人
          reason: dsnInfo.diagnostic_code || subject || "bounce",
          dsn_action: dsnInfo.dsn_action || "",
          dsn_status: dsnInfo.dsn_status || "",
          reporting_mta: dsnInfo.reporting_mta || "",
          orig_recipient: dsnInfo.orig_recipient || "",
          final_recipient: dsnInfo.final_recipient || "",
          subject: subject || "",
          source: fromAddr || "",
        };

        appendCsv(
          "data/bounces.csv",
          [
            "ts",
            "email",
            "reason",
            "dsn_action",
            "dsn_status",
            "reporting_mta",
            "orig_recipient",
            "final_recipient",
            "subject",
            "source",
          ],
          bounceRow
        );

        // 同步加入退订名单，避免再次投递（无论是否成功识别目标地址）
        if (bounceRow.email) {
          appendCsv(
            "data/unsubscribes.csv",
            ["ts", "email", "source"],
            { ts: nowIso(), email: bounceRow.email.toLowerCase(), source: "bounce" }
          );
        }

        await slack(
          `Inbound → Bounce noticed\n• from: ${fromAddr}\n• target: ${
            bounceRow.email || "(unknown)"
          }\n• status: ${bounceRow.dsn_status || "-"}\n• reason: ${
            bounceRow.reason || "-"
          }`
        );

        await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"]);
        bounces++;
        handled++;
        continue;
      }

      // —— 2) 用户回“1”开试用 / 回“9”退订
      const body = `${subject}\n${text}`.trim().toLowerCase();
      const isTrial =
        body === "1" ||
        /^\s*1\s*$/.test(body) ||
        /\breply\s*1\b/.test(body) ||
        body.startsWith("1\n");
      const isUnsub =
        body === "9" ||
        /^\s*9\s*$/.test(body) ||
        /unsubscribe|opt[-\s]?out/.test(body);

      const sender = (parsed.from?.value?.[0]?.address || "").toLowerCase();

      if (isTrial && sender) {
        appendCsv(
          "data/trials.csv",
          ["ts", "email", "source", "subject"],
          { ts: nowIso(), email: sender, source: "inbound", subject: parsed.subject || "" }
        );
        await slack(`Inbound → Trial request recorded: ${sender}`);
        await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"]);
        trials++;
        handled++;
        continue;
      }

      if (isUnsub && sender) {
        appendCsv(
          "data/unsubscribes.csv",
          ["ts", "email", "source"],
          { ts: nowIso(), email: sender, source: "inbound" }
        );
        await slack(`Inbound → Opt-out recorded: ${sender}`);
        await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"]);
        unsubs++;
        handled++;
        continue;
      }

      // 既不是退信也不是控制码：标已读即可（避免积压）
      await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"]);
      handled++;
    } catch (e) {
      await slack(`Inbound error: ${String(e && e.stack || e)}`.slice(0, 1500));
      // 不抛出，让循环继续跑
    }
  }

  await slack(
    `Inbound summary — handled:${handled} | trials:${trials} | unsub:${unsubs} | bounces:${bounces}`
  );

  await client.logout();
}

main().catch(async (err) => {
  console.error(err);
  await slack(`Inbound fatal: ${String(err && err.stack || err)}`.slice(0, 1500));
  process.exit(1);
});
