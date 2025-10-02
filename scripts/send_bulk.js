// scripts/send_bulk.js — CG Alert stable v4
// 功能：Slack 通知 / 退订过滤 / 去重 / 重试 / 发送日志 / 60s 间隔
// Node 20+（自带 fetch）

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const nodemailer = require("nodemailer");

// ---------- utils ----------
function iso(){ return new Date().toISOString(); }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function render(tpl, row){
  return (tpl || "")
    .replaceAll("{company}", row.company||"")
    .replaceAll("{domain}",  row.domain||"")
    .replaceAll("{v1}",      row.vendor1||"")
    .replaceAll("{v2}",      row.vendor2||"")
    .replaceAll("{v3}",      row.vendor3||"");
}
async function slack(msg){
  const url = process.env.SLACK_WEBHOOK;
  if (!url) return;
  try{
    await fetch(url, {
      method: "POST",
      headers: { "content-type":"application/json" },
      body: JSON.stringify({ text: msg })
    });
  }catch(_){}
}
function appendCsvLine(filepath, fields){
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
  fs.appendFileSync(filepath, fields.join(",") + "\n", "utf8");
}
async function sendWithRetry(transporter, msg, maxRetry=3){
  let attempt = 0, lastErr;
  while (attempt < maxRetry){
    try{
      const info = await transporter.sendMail(msg);
      return { ok:true, id: info && info.messageId };
    }catch(e){
      lastErr = e;
      const text = (e && (e.response || e.message) || "").toString();
      const recoverable = /(^4\d\d)|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|ESOCKET/i.test(text);
      attempt++;
      if (!recoverable || attempt >= maxRetry) break;
      const backoff = 30000 * attempt; // 30s, 60s, 90s
      console.warn(`[retry ${attempt}] ${text} → sleep ${backoff/1000}s`);
      await sleep(backoff);
    }
  }
  return { ok:false, err:lastErr };
}

// ---------- main ----------
async function main(){
  // args: csv_path limit offset subject_tpl body_tpl
  const csvPath   = process.argv[2] || "data/leads.csv";
  const limit     = parseInt(process.argv[3] || "20", 10);
  const offset    = parseInt(process.argv[4] || "0", 10);
  const subjectT  = process.argv[5] || "Renewal heads-up: {v1}/{v2} updates you may want for due diligence";
  const bodyT     = process.argv[6] || "Hi {company} team — quick heads-up.\n\nWe detected recent public changes across {v1}/{v2}/{v3} (pricing / terms / DPA / subprocessors / status). This may affect renewal or compliance.\n\nReply “1” to start a 7-day pilot. No login. Alerts delivered by email/Slack with a verifiable evidence card (diff + source + hash). Reply “9” to opt out.\n\n— CG Alert";

  // read leads
  let rows = [];
  try{
    const txt = fs.readFileSync(csvPath, "utf8");
    rows = parse(txt, { columns:true, skip_empty_lines:true, trim:true });
  }catch(e){
    console.error("Failed to read/parse CSV:", e.toString());
    await slack(`Outreach fatal → cannot read ${csvPath}`);
    process.exit(1);
  }

  const batch = rows.slice(offset, offset + limit);
  if (!batch.length){
    console.log("No rows to send (empty targets).");
    await slack("Outreach summary → sent=0, fail=0 (empty targets)");
    return;
  }

  // build unsubscribe set
  let unsubSet = new Set();
  try{
    const unsubTxt  = fs.readFileSync("data/unsubscribes.csv", "utf8");
    const unsubRows = parse(unsubTxt, { columns:true, skip_empty_lines:true, trim:true });
    for (const r of unsubRows){
      const e = (r.email||"").trim().toLowerCase();
      if (e) unsubSet.add(e);
    }
  }catch(_){
    console.warn("No data/unsubscribes.csv yet — full batch.");
  }

  // dedupe & filter
  const seen = new Set();
  const rowsToSend = batch.filter(r=>{
    const e = (r.email||"").trim().toLowerCase();
    if (!e) return false;
    if (unsubSet.has(e)){ console.log("SKIP (opt-out):", e); return false; }
    if (seen.has(e)){    console.log("SKIP (dup):", e);     return false; }
    seen.add(e);
    return true;
  });
  if (!rowsToSend.length){
    console.log("Nothing to send after filtering (all unsub/dup/invalid).");
    await slack("Outreach summary → sent=0, fail=0 (all filtered)");
    return;
  }

  // SMTP env
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM;
  const fromName = process.env.MAIL_FROM_NAME || "CG Alert";

  if (!host || !user || !pass || !from){
    const miss = ["SMTP_HOST","SMTP_USER","SMTP_PASS","MAIL_FROM"].filter(k=>!process.env[k]).join(", ");
    console.error("Missing SMTP env:", miss);
    await slack(`Outreach fatal → missing SMTP env: ${miss}`);
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host, port, secure:false, auth:{ user, pass },
    pool:true, maxConnections:1, maxMessages:50,
    rateDelta: 60000, rateLimit: 8, // 1 分钟最多 8 封（我们另外每封 sleep 60s，更稳）
    tls: { ciphers:"TLSv1.2" },
    logger:true, debug:true
  });
  try{
    await transporter.verify();
    console.log("SMTP verified:", host);
  }catch(e){
    console.warn("SMTP verify warn:", (e && e.message) || e);
  }

  let sent=0, fail=0;
  const stage = process.env.CG_STAGE || "1";

  for (const row of rowsToSend){
    const to = (row.email||"").trim();
    const subject = render(subjectT, row);
    const body    = render(bodyT, row);

    const msg = {
      envelope: { from, to },
      from: `"${fromName}" <${from}>`,
      to, subject, text: body,
      headers: {
        "List-Unsubscribe": `<mailto:${from}>`,
        "X-CG-Template": `bulk-stage-${stage}`
      }
    };

    const res = await sendWithRetry(transporter, msg, 3);

    // log + slack
    if (res.ok){
      console.log("OK:", to, res.id||"");
      await slack(`Outreach OK → ${to}`);
      sent++;
    }else{
      const why = (res.err && (res.err.response || res.err.message)) || "";
      console.error("FAIL:", to, why);
      await slack(`Outreach FAIL → ${to} — ${String(why).slice(0,140)}`);
      fail++;
    }

    // append to sent_log.csv
    appendCsvLine("data/sent_log.csv", [
      iso(),
      to.toLowerCase(),
      stage,
      (res.ok ? "OK" : "FAIL"),
      JSON.stringify(subject||"")
    ]);

    // 间隔：60s/封（暖箱期）
    await sleep(60000);
  }

  console.log(`Done. sent=${sent}, fail=${fail}`);
  await slack(`Outreach summary → sent=${sent}, fail=${fail}`);
}

// run
main()
  .then(()=>process.exit(0))
  .catch(async e=>{
    console.error("Fatal:", e);
    await slack(`Outreach fatal → ${String(e && (e.message||e)).slice(0,160)}`);
    process.exit(1);
  });
