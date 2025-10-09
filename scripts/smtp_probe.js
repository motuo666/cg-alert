// SMTP 探针：验证连接/登录；可选发送一封到 PROBE_TO
const nodemailer = require('nodemailer');

const HOST = process.env.SMTP_HOST;
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.FROM_ADDR || 'outreach@mail2.cg-alert.com';
const TO   = process.env.PROBE_TO || '';

async function main(){
  const secure = PORT === 465;
  const tr = nodemailer.createTransport({
    host: HOST, port: PORT, secure,
    auth: { user: USER, pass: PASS },
    requireTLS: !secure,
    tls: { minVersion: 'TLSv1.2' },
    logger: true, debug: true
  });

  console.log(`[probe] connecting smtp://${HOST}:${PORT} as ${USER} (secure=${secure})`);
  const ok = await tr.verify().catch(e=>{ console.error('[probe] verify fail:', e && (e.response || e.message || e)); process.exit(1); });
  console.log('[probe] verify ok:', ok);

  if(TO){
    console.log(`[probe] sending test mail from ${FROM} to ${TO}`);
    await tr.sendMail({
      from: { name: 'CG Alert Probe', address: FROM },
      to: TO, subject: 'CG Alert SMTP Probe',
      text: 'This is a test from GitHub Actions probe.',
      headers: { 'Auto-Submitted': 'auto-generated' }
    }).then(()=>console.log('[probe] send ok')).catch(e=>{
      console.error('[probe] send fail:', e && (e.response || e.message || e)); process.exit(2);
    });
  }
}
main();
