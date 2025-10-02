// scripts/poll_inbox.js — stable r5 (step-by-step diagnostics)
const fs = require("fs");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { stringify } = require("csv-stringify/sync");
const nodemailer = require("nodemailer");

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
    await fetch(url, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ text: msg }) });
  } catch(_) {}
}
function nowIso(){ return new Date().toISOString(); }
async function sendAck(to, text) {
  try{
    const host = process.env.SMTP_HOST, port = parseInt(process.env.SMTP_PORT||"587",10);
    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
    const from = process.env.MAIL_FROM, fromName = process.env.MAIL_FROM_NAME || "CG Alert";
    if (!host||!user||!pass||!from) return;
    const tx = nodemailer.createTransport({ host, port, secure:false, auth:{user,pass}, tls:{ ciphers:"TLSv1.2" } });
    await tx.sendMail({ envelope:{ from, to }, from: `"${fromName}" <${from}>`, to, subject:"CG Alert — confirmed", text });
  }catch(_){}
}

async function main(){
  const IMAP_HOST = process.env.IMAP_HOST || "imap.zoho.com";
  const IMAP_PORT = parseInt(process.env.IMAP_PORT || "993", 10);
  const IMAP_USER = process.env.IMAP_USER || process.env.SMTP_USER;
  const IMAP_PASS = process.env.IMAP_PASS || process.env.SMTP_PASS;

  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) throw new Error("Missing IMAP env");

  let client;
  try {
    client = new ImapFlow({
      host: IMAP_HOST, port: IMAP_PORT, secure: true,
      auth: { user: IMAP_USER, pass: IMAP_PASS },
      logger: false, tls: { servername: IMAP_HOST }
    });

    // 低层错误
    client.on("error", e => slack(`Inbound low-level: ${String(e?.message||e).slice(0,200)}`));

    // 1) CONNECT
    try {
      await client.connect();
    } catch(e) {
      throw new Error(`CONNECT failed (${IMAP_HOST}): ${e?.response || e?.message || e}`);
    }

    // 2) OPEN MAILBOX
    try {
      await client.mailboxOpen("INBOX", { readOnly:false });
    } catch(e) {
      throw new Error(`OPEN INBOX failed: ${e?.response || e?.message || e}`);
    }

    // 3) SEARCH recent unseen
    let uids;
    try {
      const since = new Date(Date.now() - 2*24*3600*1000);
      uids = await client.search({ seen:false, since }, { uid:true });
    } catch(e) {
      throw new Error(`SEARCH failed: ${e?.response || e?.message || e}`);
    }

    let handled = 0;
    for (const uid of uids.slice(0,50)){
      // 4) DOWNLOAD
      let parsed, fromAddr="", subject="", bodyText="";
      try {
        const { content } = await client.download(uid);
        parsed = await simpleParser(content);
        fromAddr = (parsed.from?.value?.[0]?.address) || "";
        subject = (parsed.subject || "").trim();
        bodyText = (parsed.text || "").trim();
      } catch(e) {
        await slack(`DOWNLOAD/PARSE failed uid=${uid}: ${e?.message || e}`); 
        continue;
      }

      const text = `${subject}\n${bodyText}`.toLowerCase();
      const isOptOut = /\bunsubscribe\b|\bopt[- ]?out\b|^9$|\n9\b/.test(text);
      const isTrial  = /^1$|\n1\b/.test(text);

      try{
        if (isOptOut && fromAddr){
          appendCsv("data/unsubscribes.csv", {
            email: fromAddr.toLowerCase(), company:"", domain:(fromAddr.split("@")[1]||""),
            vendor1:"", vendor2:"", vendor3:"", ts: nowIso()
          });
          await slack(`Inbound → Opt-out recorded: ${fromAddr}`);
          await sendAck(fromAddr, "Opt-out confirmed. You won't receive further outreach from CG Alert.");
          await client.messageFlagsAdd(uid, ["\\Seen"]);
          handled++; continue;
        }
        if (isTrial && fromAddr){
          appendCsv("data/trials.csv", {
            email: fromAddr.toLowerCase(), company:"", domain:(fromAddr.split("@")[1]||""), vendors:"", ts: nowIso()
          });
          await slack(`Inbound → Trial request recorded: ${fromAddr}`);
          await sendAck(fromAddr, "Pilot confirmed. We’ll start a 7-day trial and share alerts via email/Slack. Reply 9 to opt out anytime.");
          await client.messageFlagsAdd(uid, ["\\Seen"]);
          handled++; continue;
        }
        // 其它邮件：标已读防重复
        await client.messageFlagsAdd(uid, ["\\Seen"]);
      } catch(e){
        await slack(`FLAG/WRITE failed uid=${uid}: ${e?.response || e?.message || e}`);
      }
    }

    if (handled === 0) console.log("No actionable messages.");
    await client.logout();
  } catch (e) {
    const why = e?.stack || e?.message || String(e);
    await slack(`Inbound error: ${String(why).slice(0,300)}`);
    throw e;
  }
}

main().catch(()=>process.exit(1));
