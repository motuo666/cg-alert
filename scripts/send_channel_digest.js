#!/usr/bin/env node
const fs=require('fs'), path=require('path'), nodemailer=require('nodemailer');

const SITE='https://www.cg-alert.com';
const Y = new Date().toISOString().slice(0,7); // YYYY-MM

const host=process.env.SMTP_HOST, port=Number(process.env.SMTP_PORT||587);
const user=process.env.SMTP_USER, pass=process.env.SMTP_PASS, from=process.env.MAIL_FROM;
if(!host||!user||!pass||!from){ console.error('SMTP_* not set'); process.exit(1); }

const partnersFile='data/channel_partners.csv';
if(!fs.existsSync(partnersFile)){ console.log('no channel_partners.csv'); process.exit(0); }

const t = nodemailer.createTransport({ host, port, secure: port===465, auth:{ user, pass } });

function rows(p){
  return fs.readFileSync(p,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(l=>{
    const [email,name,slug]=l.split(',').map(s=>s?.trim());
    return {email,name,slug};
  });
}

(async function main(){
  const partners = rows(partnersFile);
  for(const p of partners){
    const subject = `Monthly Digest ${Y} — Evidence-backed vendor changes`;
    const url = `${SITE}/reports/${Y}/`;
    const body = [
      `Hi ${p.name||'Partner'},`,
      ``,
      `Here is the ${Y} evidence-backed digest of public changes (Pricing / ToS / DPA / Subprocessors / Status).`,
      `${url}`,
      ``,
      `You can also browse historical reports: ${SITE}/reports/`,
      ``,
      `If you'd like a co-branded version for your customers, reply to this email.`,
      ``,
      `— CG Alert`,
    ].join('\n');
    try{
      await t.sendMail({ from, to:p.email, subject, text:body, headers:{
        'List-Unsubscribe': `<mailto:${from}?subject=unsubscribe>`
      }});
      console.log('[digest] sent to', p.email);
    }catch(e){ console.error('[digest][err]', p.email, e.message); }
  }
})();
