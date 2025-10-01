const nodemailer = require("nodemailer");

async function main() {
  const [to, subject, body] = process.argv.slice(2);
  if (!to || !subject || !body) {
    console.error("Usage: node scripts/send_email.js <to> <subject> <body>");
    process.exit(1);
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { ciphers: "TLSv1.2" },
  });
  const info = await transporter.sendMail({
    from: `"${process.env.MAIL_FROM_NAME || "CG Alert"}" <${process.env.MAIL_FROM}>`,
    to, subject, text: body,
    headers: { "X-CG-Env":"test", "List-Unsubscribe": `<mailto:${process.env.MAIL_FROM}>` },
  });
  console.log("Message sent:", info.messageId);
}
main().catch(e => { console.error(e); process.exit(1); });
