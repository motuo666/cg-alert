// scripts/smtp_probe.js
const nodemailer = require('nodemailer');
const HOST = process.env.SMTP_HOST;
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.FROM_ADDR || 'outreach@mail2.cg-alert.com';
const TO   = process.env.PROBE_TO || '';

async function main(){
  const tr = nodemailer.createTransport({
    host: HOST, port: PORT, secure: PORT===465,
    auth: { user: USER, pass: PASS },
    requireTLS: PORT!==465, tls: { minVersion: 'TLSv1.2' },
    logger: true, debug: true
  });
  console.log(`[probe] verify smtp://${HOST}:${PORT} as ${USER}`);
  await tr.verify();
  console.log('[probe] verify ok');
  if(TO){
    console.log(`[probe] send test to ${TO}`);
    await tr.sendMail({
      from: { name: 'CG Alert Probe', address: FROM },
      to: TO, subject: 'CG Alert SMTP Probe',
      text: 'GitHub Actions probe OK.',
      headers: { 'Auto-Submitted': 'auto-generated' }
    });
    console.log('[probe] send ok');
  }
}
main().catch(e=>{ console.error('[probe] fail:', e && (e.response || e.message || e)); process.exit(1); });
