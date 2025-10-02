// scripts/poll_inbox.js — stable r4
// 功能：IMAP 读 Zoho 收件箱，识别 “1/9/unsubscribe”，写 trials.csv / unsubscribes.csv，报错详细推 Slack。
// 依赖：imapflow, mailparser, csv-parse, csv-stringify, nodemailer（可选回信）

const fs = require("fs");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");
const nodemailer = require("nodemailer");

// ---------- utils ----------
function ensureHeader(file, header) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, header + "\n", "utf8");
}
function appendCsv(file, obj) {
  ensureHeader(file, Object.keys(obj).join(","));
  const line = Object.values(obj).map(v =>
    String(v ?? "").includes(",") ? `"${String(v).replace(/"/g,'""')}"` : String(v ?? "")
  ).join(",");
  fs.appendFileSync(file, line + "\n", "utf8");
}
async function slack(msg) {
  const url = process.env.SLACK_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body: JSON.stringify({ text: msg })
    });
  } catch(_) {}
}
function nowIso(){ return new Date().toISOString(); }

async function sendAck(to, text) {
  // 可选回信；不想回可以直接 return
  try{
    const host = process.env.SMTP_HOST, port = parseInt(process.env.SMTP_PORT||"587",10);
    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
    const from = process.env.MAIL_FROM, fromName = process.env.MAIL_FROM_NAME || "CG Alert";
    if (!host||!user||!pass||!from) return;

    const tx = nodemailer.createTransport({ host, port, secure:false, auth:{user,pass}, tls:{ ciphers:"TLSv1.2" } });
    await tx.sendMail({
      envelope:{ from, to },
      from: `"${fromName}" <${from}>`,
      to, subject: "CG Alert — confirmed",
      text
    });
  }catch(_){}
}

// ---------- main ----------
async function main(){
  const IMAP_HOST = process.env.IMAP_HOST || "imap.zoho.com"; // EU 用 imap.zoho.eu
  const IMAP_PORT = parseInt(process.env.IMAP_PORT || "993", 10);
  const IMAP_USER = process.env.IMAP_USER || process.env.SMTP_USER;
  const IMAP_PASS = process.env.IMAP_PASS || process.env.SMTP_PASS;

  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) {
    throw new Error("Missing IMAP env (IMAP_HOST/IMAP_USER/IMAP_PASS)");
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
    tls: { servername: IMAP_HOST }
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    // 只看最近 2 天未读，最多 50 封
    const since = new Date(Date.now() - 2*24*3600*1000);
    const search = { seen: false, since };
    const messages = [];
    for await (let msg of client.search(search, { uid: true })) {
      messages.push(msg);
      if (messages.length >= 50) break;
    }

    let handled = 0;
    for (const uid of messages){
      const { content } = await client.download(uid);
      const parsed = await simpleParser(content);
      const fromAddr = (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || "";
      const subject = (parsed.subject || "").trim();
      const bodyText = (parsed.text || "").trim();

      const text = `${subject}\n${bodyText}`.toLowerCase();
      const isOptOut = /\bunsubscribe\b|\bopt[- ]?out\b|^9$|\n9\b/.test(text);
      const isTrial  = /^1$|\n1\b/.test(text);

      if (isOptOut && fromAddr){
        appendCsv("data/unsubscribes.csv", {
          email: fromAddr.toLowerCase(),
          company: "",
          domain: fromAddr.split("@")[1] || "",
          vendor1:"", vendor2:"", vendor3:"",
          ts: nowIso()
        });
        await slack(`Inbound → Opt-out recorded: ${fromAddr}`);
        await sendAck(fromAddr, "Opt-out confirmed. You won't receive further outreach from CG Alert.");
        await client.messageFlagsAdd(uid, ["\\Seen"]);
        handled++;
        continue;
      }

      if (isTrial && fromAddr){
        appendCsv("data/trials.csv", {
          email: fromAddr.toLowerCase(),
          company: "",
          domain: fromAddr.split("@")[1] || "",
          vendors: "",
          ts: nowIso()
        });
        await slack(`Inbound → Trial request recorded: ${fromAddr}`);
        await sendAck(fromAddr, "Pilot confirmed. We’ll start a 7-day trial and share alerts via email/Slack. Reply 9 to opt out anytime.");
        await client.messageFlagsAdd(uid, ["\\Seen"]);
        handled++;
        continue;
      }

      // 其它邮件：仅标记已读，避免重复轮询
      await client.messageFlagsAdd(uid, ["\\Seen"]);
    }

    if (handled === 0) {
      console.log("No actionable messages.");
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

main().catch(async e=>{
  const why = (e && (e.stack || e.message)) || String(e);
  console.error("Inbound fatal:", why);
  await slack(`Inbound error: ${why.slice(0,300)}`);
  process.exit(1);
});
