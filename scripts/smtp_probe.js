// scripts/smtp_probe.js
const nodemailer = require('nodemailer');

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, PROBE_TO } = process.env;
if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
  console.error('❌ 缺少 SMTP_* secrets');
  process.exit(1);
}
const port = Number(SMTP_PORT);
const secure = port === 465;

async function main() {
  const transport = nodemailer.createTransport({
    host: SMTP_HOST, port, secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false }
  });
  await transport.verify();
  console.log('✅ SMTP 连接可用');
  if (PROBE_TO) {
    await transport.sendMail({
      from: SMTP_USER,
      to: PROBE_TO,
      subject: 'CG Alert SMTP Probe',
      text: 'SMTP OK',
    });
    console.log('✉️ 已发送测试信到:', PROBE_TO);
  }
}
main().catch(e => { console.error('❌ SMTP probe 失败:', e.message); process.exit(1); });
