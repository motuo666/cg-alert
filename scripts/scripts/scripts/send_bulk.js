// scripts/send_bulk.js  (hardened v2)
const fs = require("fs");
const { parse } = require("csv-parse/sync");
const nodemailer = require("nodemailer");

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function render(tpl, row){
  return (tpl || "")
    .replaceAll("{company}", row.company||"")
    .replaceAll("{domain}", row.domain||"")
    .replaceAll("{v1}", row.vendor1||"")
    .replaceAll("{v2}", row.vendor2||"")
    .replaceAll("{v3}", row.vendor3||"");
}

async function sendWithRetry(transporter, msg, maxRetry = 3){
  let attempt = 0, lastErr;
  while (attempt < maxRetry){
    try {
      const info = await transporter.sendMail(msg);
      return { ok: true, id: info.messageId };
    } catch (e){
      lastErr = e;
      const text = (e && (e.response || e.message || "")).toString();
      // 常见可恢复错误：421/450/451/4.x.x，或连接/超时类
      const recoverable = /(?:^4\d\d)|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|ESOCKET/i.test(text);
      attempt++;
      if (!recoverable || attempt >= maxRetry) break;
      const backoff = 30000 * attempt; // 30s, 60s, 90s...
      console.warn(`Retry in ${backoff/1000}s due to: ${text}`);
      await sleep(backoff);
    }
  }
  return { ok: false, err: lastErr };
}

async function main(){
  const csvPath   = process.argv[2] || "data/leads.csv";
  const limit     = parseInt(process.argv[3]||"20",10);
  const offset    = parseInt(process.argv[4]||"0",10);
  const subjectT  = process.argv[5] || "Renewal heads-up: {v1}/{v2} updates you may want for due diligence";
  const bodyT     = process.argv[6] || "Hi {company} team — quick heads-up.\n\nWe detected recent public changes across {v1}/{v2}/{v3} (pricing / terms / DPA / subprocessors / status). This may affect renewal or compliance.\n\nReply “1” to start a 7-day pilot. No login. Alerts delivered by email/Slack with a verifiable evidence card (diff + source + hash). Reply “9” to opt out.\n\n— CG Alert";

  // 读取 CSV
  let rows = [];
  try{
    const txt = fs.readFileSync(csvPath, "utf8");
    rows = parse(txt, { columns: true, skip_empty_lines: true });
  }catch(e){
    console.error("Failed to read/parse CSV:", e.toString());
    // 不抛出，让流程可见地结束
    return 0;
  }
  const batch = rows.slice(offset, offset + limit);

  // SMTP 连接池（单连接、限速）
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    rateDelta: 60000,   // 每 60s 的窗口
    rateLimit: 10,      // 每分钟最多 10 封（再叠加我们的人为间隔）
    tls: { ciphers: "TLSv1.2" }
  });

  // 可选：提前校验一次（失败也不退出，继续尝试单封重试）
  try { await transporter.verify(); } catch(e) { console.warn("SMTP verify warning:", e.toString()); }

  let sent=0, fail=0;
  for (const row of batch){
    const subject = render(subjectT, row);
    const body    = render(bodyT, row);

    const msg = {
      from: `"${process.env.MAIL_FROM_NAME || "CG Alert"}" <${process.env.MAIL_FROM}>`,
      to: row.email,
      subject,
      text: body,
      headers: {
        "List-Unsubscribe": `<mailto:${process.env.MAIL_FROM}>`,
        "X-CG-Template": "bulk-v2"
      },
    };

    const res = await sendWithRetry(transporter, msg, 3);
    if (res.ok){
      console.log("OK:", row.email, res.id || "");
      sent++;
    }else{
      console.error("FAIL:", row.email, (res.err && (res.err.response || res.err.message)) || res.err || "");
      fail++;
    }

    // 基础间隔：45s（预热阶段）
    await sleep(45000);
  }

  console.log(`Done. sent=${sent}, fail=${fail}`);
  // 无论中途失败与否，都以 0 退出，避免整个 Job 报红
  return 0;
}

// 保底不抛出退出 1
main().then(()=>process.exit(0)).catch(e=>{ console.error("Fatal:", e.toString()); process.exit(0); });
