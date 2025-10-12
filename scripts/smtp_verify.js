#!/usr/bin/env node
// smtp_verify.js — verify SMTP credentials quickly
const nodemailer=require('nodemailer');
(async function(){
  try{ const t=nodemailer.createTransport({ host:process.env.SMTP_HOST, port:Number(process.env.SMTP_PORT||587), secure:Number(process.env.SMTP_PORT)==465, auth:{user:process.env.SMTP_USER, pass:process.env.SMTP_PASS} });
    await t.verify(); console.log('SMTP OK'); process.exit(0);
  }catch(e){ console.error('SMTP ERR', e.message); process.exit(1); }
})();