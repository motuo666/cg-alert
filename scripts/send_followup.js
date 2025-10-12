#!/usr/bin/env node
// send_followup.js — very low-volume follow-up (replay to prev sent leads). Keep disabled by default.
const fs=require('fs'), path=require('path'), nodemailer=require('nodemailer');
const { SMTP_HOST, SMTP_PORT=587, SMTP_USER, SMTP_PASS, MAIL_FROM, BCC_TO } = process.env;
(async function main(){
  const transport = nodemailer.createTransport({ host:SMTP_HOST, port:Number(SMTP_PORT), secure:Number(SMTP_PORT)===465, auth:{user:SMTP_USER, pass:SMTP_PASS} });
  const list = (fs.existsSync('data/sent_log.csv')?fs.readFileSync('data/sent_log.csv','utf8').split(/\r?\n/).filter(Boolean):[]).slice(-5);
  let sent=0; for(const _ of list){ try{ await transport.sendMail({ from:MAIL_FROM, to:MAIL_FROM, bcc:BCC_TO||undefined, subject:'(follow-up) CG Alert', html:'<p>Follow-up sample.</p>' }); sent++; }catch(e){} }
  try{ await transport.close(); }catch(e){}
  console.log(`[followup] sent=${sent}`);
})().catch(e=>{ console.error(e); process.exit(0); });