// Outreach sender (ops@cg-alert.com default)
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM || 'CG Alert Ops <ops@cg-alert.com>';
const POSTAL = process.env.MAIL_POSTAL_ADDRESS || '—';
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const HMAC_SECRET = process.env.UNSUB_HMAC_SECRET || '';

const POR = process.env.STRIPE_LINK_PORTFOLIO || '#';
const COM = process.env.STRIPE_LINK_COMPLIANCE || '#';
const ENT = process.env.STRIPE_LINK_ENTERPRISE || '#';
const INTAKE = process.env.INTAKE_FORM_URL || '#';

function unsubLink(email){
  if(!HMAC_SECRET || !email) return `${SITE}/unsubscribe`;
  const h = crypto.createHmac('sha256', HMAC_SECRET).update(String(email)).digest('hex');
  return `${SITE}/unsubscribe?e=${encodeURIComponent(email)}&t=${h}`;
}

function body(company, email){
  return `Hi ${company || 'there'},

We ship evidence-backed vendor change alerts you can paste into renewal emails.

• Portfolio — continuous monitoring of up to 25 vendors you specify, with timestamped evidence and leverage language. ${POR}
• Compliance & Vendor Risk — DPA/subprocessor monitoring for Security/Legal. ${COM}
• Enterprise — up to 200 vendors + custom routing. ${ENT}

Prefer to start with a quick intake? ${INTAKE}

Best,
CG Alert
${SITE}

—
You’re receiving this because your work touches vendor renewals or compliance.
Postal: ${POSTAL}
Unsubscribe: ${unsubLink(email)}`;
}

async function main(){
  const fs = require('fs');
  const leadsPath = 'data/leads.csv';
  const exists = fs.existsSync(leadsPath);
  if(!exists){ console.error('no data/leads.csv'); process.exit(0); }
  const leads = fs.readFileSync(leadsPath,'utf8').trim().split(/\r?\n/).slice(1).map(l=>l.split(','));
  const sentLog = 'data/sent_log.csv';
  const outLog = 'data/outreach_log.csv';
  const sent = new Set(fs.existsSync(sentLog) ? fs.readFileSync(sentLog,'utf8').split(/\r?\n/).map(x=>x.split(',')[0].toLowerCase()) : []);

  const tr = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: (SMTP_PORT===465), auth: { user: SMTP_USER, pass: SMTP_PASS } });

  const toSend = [];
  for(const row of leads){
    const email = (row[1]||'').toLowerCase();
    const company = row[0]||'';
    if(!email || sent.has(email)) continue;
    toSend.push({email, company});
    if(toSend.length >= 25) break;
  }

  const lines = [];
  for(const it of toSend){
    const msg = {
      from: FROM,
      to: it.email,
      subject: `Leverage your vendor renewals with hard evidence`,
      text: body(it.company, it.email),
    };
    try{
      await tr.sendMail(msg);
      lines.push(`${it.email},${new Date().toISOString()}`);
      console.log('sent', it.email);
    }catch(e){
      console.error('fail', it.email, e && e.message);
    }
  }

  if(lines.length){
    require('fs').appendFileSync(sentLog, lines.join('\n')+'\n', 'utf8');
    require('fs').appendFileSync(outLog, lines.map(l=>`EMAIL,${l}`).join('\n')+'\n', 'utf8');
  }
}

if(require.main === module){
  main().catch(e=>{ console.error(e); process.exit(1); });
}
