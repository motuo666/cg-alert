// scripts/send_bulk.js  — stable v3 (unsub filter + dedup + retry + slack + 60s interval)
const fs = require("fs");
const { parse } = require("csv-parse/sync");
const nodemailer = require("nodemailer");
const path = require("path");
function appendCsvLine(filepath, line){
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filepath, line + "\n", "utf8");
}
function iso(){ return new Date().toISOString(); }


// ===== helpers =====
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function render(tpl, row){
  return (tpl || "")
    .replaceAll("{company}", row.company||"")
    .replaceAll("{domain}", row.domain||"")
    .replaceAll("{v1}", row.vendor1||"")
    .replaceAll("{v2}", row.vendor2||"")
    .replaceAll("{v3}", row.vendor3||"");
}
async function slack(msg){
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
async function sendWithRetry(transporter, msg, maxRetry = 3){
  let attempt = 0, lastErr;
  while (attempt < maxRetry){
    try { const info = await transporter.sendMail(msg); return { ok:true, id:info.messageId }; }
    catch(e){
      lastErr = e;
      const text = (e && (e.response || e.message || "")).toString();
      const recoverable = /(?:^4\d\d)|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|ESOCKET/i.test(text);
      attempt++;
      if (!recoverable || attempt >= maxRetry) break;
      const backoff = 30000 * attempt; // 30s, 60s, 90s
      console.warn(`[retry ${attempt}] ${text} → sleep ${backoff/1000}s`);
      await slack(`Outreach retry ${attempt} → ${text}`);
      await sleep(backoff);
    }
  }
  return { ok:false, err:lastErr };
}

// ===== main =====
async function main(){
  const csvPath   = process.argv[2] || "data/leads.csv";
  const limit     = parseInt(process.argv[3]||"20",10);
  const offset    = parseInt(process.argv[4]||"0",10);
  const subjectT  = process.argv[5] || "Renewal heads-up: {v1}/{v2} updates you may want for due diligence";
  const bodyT     = process.argv[6] || "Hi {company} team — quick heads-up.\n\nWe detected recent public changes across {v1}/{v2}/{v3} (pricing / terms / DPA / subprocessors / status). This may affect renewal or compliance.\n\nReply “1” to start a 7-day pilot. No login. Alerts delivered by email/Slack with a verifiable evidence card (diff + source + hash). Reply “9” to opt out.\n\n— CG Alert";

  // 读取 leads
  let rows = [];
  try{
    const txt = fs.readFileSync(csvPath, "utf8");
    rows = parse(txt, { columns: true, skip_empty_lines: true, trim: true });
  }catch(e){ console.error("Failed to read/parse CSV:", e.toString()); return 0; }

  const batch = rows.slice(offset, offset + limit);
  if (!batch.length){ console.log("No rows to send."); return 0; }

  // 读取退订并过滤 + 去重
  let unsubSet = new Set();
  try {
    const unsubTxt = fs.readFileSync("data/unsubscribes.csv", "utf8");
    const unsubRows = parse(unsubTxt, { columns: true, skip_empty_lines: true, trim: true });
    for (const r of unsubRows) {
      const e = (r.email || "").trim().toLowerCase();
      if (e) unsubSet.add(e);
    }
  } catch (_) { console.warn("No data/unsubscribes.csv yet — sending to full batch."); }

  const seen = new Set();
  const rowsToSend = batch.filter(r => {
    const e = (r.email || "").trim().toLowerCase();
    if (!e) return false;
    if (unsubSet.has(e)) { console.log("SKIP (opt-out):", e); return false; }
    if (seen.has(e)) { console.log("SKIP (dup):", e); return false; }
    seen.add(e);
    return true;
  });
  if (!rowsToSend.length){ console.log("Nothing to send after filtering."); return 0; }

  // SMTP 连接池 + 调试
  const host = process.env.SMTP_HOST, port = parseInt(process.env.SMTP_PORT||"587",10);
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM, fromName = process.env.MAIL_FROM_NAME || "CG Alert";
  if (!host||!user||!pass||!from){ console.error("Missing SMTP env (host/user/pass/from)."); return 0; }

  const transporter = nodemailer.createTransport({
    host, port, secure: false, auth: { user, pass },
    pool: true, maxConnections: 1, maxMessages: 50,
    rateDelta: 60000, rateLimit: 8, tls: { ciphers:"TLSv1.2" },
    logger: true, debug: true
  });
  try { await transporter.verify(); console.log("SMTP verified:", host); } catch(e){ console.warn("SMTP verify warning:", e.toString()); }

  let sent=0, fail=0;
  for (const row of rowsToSend){
    const subject = render(subjectT, row);
    const body    = render(bodyT, row);
    const msg = {
      envelope: { from, to: row.email },                 // 确保 Return-Path/MAIL FROM 一致
      from: `"${fromName}" <${from}>`,
      to: row.email,
      subject, text: body,
      headers: { "List-Unsubscribe": `<mailto:${from}>`, "X-CG-Template":"bulk-v3" },
    };
    const res = await sendWithRetry(transporter, msg, 3);
    if (res.ok){
      console.log("OK:", row.email, res.id||"");
      await slack(`Outreach OK → ${row.email}`);
      sent++;
    }else{
      const reason = (res.err && (res.err.response || res.err.message)) || res.err || "";
      console.error("FAIL:", row.email, reason);
      await slack(`Outreach FAIL → ${row.email}`);
      fail++;
    }
    await sleep(60000); // 60s/封：暖箱 & 限速
  }

  console.log(`Done. sent=${sent}, fail=${fail}`);
  await slack(`Outreach summary → sent=${sent}, fail=${fail}`);
  return 0;
}

main().then(()=>process.exit(0)).catch(async e=>{ 
  console.error("Fatal:", e.toString());
  await slack(`Outreach fatal → ${e.message||e}`);
  process.exit(0);
});
