// scripts/send_one.js — send a single test email via SMTP (Zoho)
const nodemailer = require("nodemailer");

async function slack(msg){
  const url = process.env.SLACK_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ text: msg }) });
  } catch(_) {}
}

async function main(){
  const to = process.argv[2];
  const subject = process.argv[3] || "CG Alert — test";
  const body = process.argv[4] || "This is a test email from CG Alert.";
  if(!to){ console.error("Usage: node scripts/send_one.js <to> [subject] [body]"); process.exit(1); }

  const host = process.env.SMTP_HOST, port = parseInt(process.env.SMTP_PORT||"587",10);
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM, fromName = process.env.MAIL_FROM_NAME || "CG Alert";
  if(!host||!user||!pass||!from){ console.error("Missing SMTP env (host/user/pass/from)"); process.exit(1); }

  const tx = nodemailer.createTransport({
    host, port, secure: false, auth: { user, pass },
    tls: { ciphers: "TLSv1.2" }, logger: true, debug: true
  });

  try { await tx.verify(); console.log("SMTP verified:", host); } catch(e){ console.warn("verify warn:", e.message); }

  try{
    const info = await tx.sendMail({
      envelope: { from, to },
      from: `"${fromName}" <${from}>`,
      to, subject, text: body,
      headers: { "List-Unsubscribe": `<mailto:${from}>`, "X-CG-Template": "test-one" }
    });
    console.log("OK:", to, info.messageId || "");
    await slack(`Test OK → ${to}`);
  } catch(e){
    const why = (e && (e.response || e.message)) || e;
    console.error("FAIL:", to, why);
    await slack(`Test FAIL → ${to} — ${String(why).slice(0,140)}`);
    process.exit(1);
  }
}
main();
