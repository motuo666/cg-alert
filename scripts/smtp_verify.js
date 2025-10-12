#!/usr/bin/env node
// smtp_verify.js —— 在真实发信前验证 Brevo/SES 等 SMTP 是否可用
const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 465);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

if (!host || !user || !pass) {
  console.error('❌ SMTP env missing (SMTP_HOST/SMTP_USER/SMTP_PASS).');
  process.exit(1);
}

const tx = nodemailer.createTransport({
  host, port,
  secure: port === 465, // 465=SSL, 587=STARTTLS
  auth: { user, pass },
});

(async () => {
  try {
    const ok = await tx.verify();
    console.log(`✅ SMTP verify ok (${host}:${port}, user="${user}")`);
    process.exit(0);
  } catch (e) {
    console.error('❌ SMTP verify failed:', e && (e.response || e.message) || e);
    // Brevo 典型：535 Authentication failed
    process.exit(1);
  }
})();
