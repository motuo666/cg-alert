// scripts/poll_inbox.js  — IMAP inbox poll + auto-reply + Slack + CSV upsert
// Deps: imapflow, nodemailer, csv-parse, csv-stringify

const { ImapFlow } = require("imapflow");
const nodemailer = require("nodemailer");
const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");

function nowISO(){ return new Date().toISOString(); }
function lc(s){ return (s||"").toLowerCase().trim(); }

function readCsv(path){
  if (!fs.existsSync(path)) return [];
  const t = fs.readFileSync(path, "utf8");
  return parse(t, { columns: true, skip_empty_lines: true, trim: true });
}
function writeCsv(path, rows){
  const out = stringify(rows, { header: true });
  fs.writeFileSync(path, out);
}

async function slack(msg){
  const url = process.env.SLACK_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: msg }) });
  } catch {}
}

function looksOOO(subject, body){
  const s = lc(subject), b = lc(body);
  const patterns = [
    "out of office","auto reply","autoreply","vacation","away",
    "自动回复","外出","休假","离开办公室"
  ];
  return patterns.some(p => s.includes(p) || b.includes(p));
}

function bodyContainsTrial(body){
  const b = lc(body);
  // 单独的“1”，或“start/pilot/试用”等关键词
  return /(^|\s)1(\s|$)/.test(b) || /(start|pilot|trial|试用|开通)/.test(b);
}
function bodyContainsOptOut(body){
  const b = lc(body);
  return /(^|\s)9(\s|$)/.test(b) || /\bunsubscribe\b|\bopt\s*out\b|退订|取消订阅/.test(b);
}

async function main(){
  // IMAP 登录（Zoho US 默认；若你是 EU，请把 IMAP_HOST 设为 imap.zoho.eu）
  const imap = new ImapFlow({
    host: process.env.IMAP_HOST || "imap.zoho.com",
    port: parseInt(process.env.IMAP_PORT || "993", 10),
    secure: true,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASS }
  });
  await imap.connect();
  await imap.mailboxOpen("INBOX");

  // 取最近 7 天未读
  const uids = [];
  for await (const msg of imap.search({ seen: false, since: new Date(Date.now() - 7*24*3600*1000) }, { uid: true })) {
    uids.push(msg);
  }

  const trials = readCsv("data/trials.csv");
  const unsub  = readCsv("data/unsubscribes.csv");
  const trialSet = new Set(trials.map(r => lc(r.email)));
  const unsubSet = new Set(unsub.map(r => lc(r.email)));

  // SMTP 用于自动回信
  const tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { ciphers: "TLSv1.2" }
  });

  let took = 0, tri = 0, opt = 0, oth = 0;

  for (const uid of uids){
    const meta = await imap.fetchOne(uid, { envelope: true, source: true });
    const from = lc(meta.envelope?.from?.[0]?.address);
    if (!from){ await imap.messageFlagsAdd({ uid }, ["\\Seen"]); continue; }

    // 只取前几 KB 文本做粗识别（足够判断 1/9）
    const raw = meta.source.toString("utf8").slice(0, 4000);
    const subject = meta.envelope?.subject || "";
    if (looksOOO(subject, raw)) { // 自动回复直接跳过
      await imap.messageFlagsAdd({ uid }, ["\\Seen"]);
      oth++; continue;
    }

    let tag = "other";
    if (bodyContainsOptOut(raw)) tag = "optout";
    else if (bodyContainsTrial(raw)) tag = "trial";

    // 标记已读
    await imap.messageFlagsAdd({ uid }, ["\\Seen"]);
    took++;

    if (tag === "optout"){
      if (!unsubSet.has(from)) {
        unsub.push({ email: from, company:"", domain:"", vendor1:"", vendor2:"", vendor3:"", ts: nowISO() });
        unsubSet.add(from);
        await slack(`Opt-out recorded → ${from}`);
      }
      opt++;
    } else if (tag === "trial"){
      if (!trialSet.has(from)) {
        trials.push({ email: from, company:"", domain:"", vendor1:"", vendor2:"", vendor3:"", ts: nowISO() });
        trialSet.add(from);
        await slack(`Trial request → ${from}`);
      }
      // 自动回一封确认
      try {
        await tx.sendMail({
          from: `"CG Alert" <${process.env.MAIL_FROM}>`,
          to: from,
          subject: "CG Alert — your 7-day pilot is queued",
          text:
`Thanks — your 7-day pilot is queued.

Please reply with:
• Company name
• Website
• Top 3 vendors to monitor

We deliver Slack/email alerts with a verifiable evidence card (diff + source + hash). Not legal advice.

— CG Alert`
        });
      } catch {}
      tri++;
    } else {
      oth++;
    }
  }

  writeCsv("data/trials.csv", trials);
  writeCsv("data/unsubscribes.csv", unsub);
  await slack(`Inbound summary → scanned=${uids.length}, took=${took}, trials=${tri}, optouts=${opt}, others=${oth}`);

  await imap.logout();
}

main().catch(async (e)=>{
  await slack(`Inbound error: ${e.message||e}`);
  process.exit(0);
});
