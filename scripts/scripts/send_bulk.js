const fs = require("fs");
const {parse} = require("csv-parse/sync");
const nodemailer = require("nodemailer");

function tmpl(subject, body, row){
  const v1=row.vendor1||"", v2=row.vendor2||"", v3=row.vendor3||"";
  return {
    subject: subject.replaceAll("{company}", row.company||"").replaceAll("{v1}", v1).replaceAll("{v2}", v2),
    body: body
      .replaceAll("{company}", row.company||"")
      .replaceAll("{domain}", row.domain||"")
      .replaceAll("{v1}", v1).replaceAll("{v2}", v2).replaceAll("{v3}", v3)
  };
}

async function main(){
  const csvPath = process.argv[2] || "data/leads.csv";
  const limit = parseInt(process.argv[3]||"20",10);
  const offset = parseInt(process.argv[4]||"0",10);
  const subjectTpl = process.argv[5] || "Renewal heads-up: {v1}/{v2} updates you may want for due diligence";
  const bodyTpl = process.argv[6] || "Hi {company} team — quick heads-up.\n\nWe detected recent public changes across {v1}/{v2}/{v3} (pricing / terms / DPA / subprocessors / status). This may affect renewal or compliance.\n\nReply “1” to start a 7-day pilot. No login. Alerts delivered by email/Slack with a verifiable evidence card (diff + source + hash). Reply “9” to opt out.\n\n— CG Alert";

  const txt = fs.readFileSync(csvPath, "utf8");
  const rows = parse(txt, {columns: true, skip_empty_lines: true});
  const slice = rows.slice(offset, offset+limit);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT||"587",10),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { ciphers: "TLSv1.2" },
  });

  let sent=0, fail=0;
  for (const row of slice){
    const {subject, body} = tmpl(subjectTpl, bodyTpl, row);
    try{
      await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME||"CG Alert"}" <${process.env.MAIL_FROM}>`,
        to: row.email, subject, text: body,
        headers: {"List-Unsubscribe": `<mailto:${process.env.MAIL_FROM}>`},
      });
      console.log("OK:", row.email);
      sent++;
    }catch(e){
      console.error("FAIL:", row.email, e.toString());
      fail++;
    }
    await new Promise(r=>setTimeout(r, 45000)); // 45s/封，保护域名信誉
  }
  console.log(`Done. sent=${sent}, fail=${fail}`);
}

main().catch(e=>{console.error(e); process.exit(1);});
