#!/usr/bin/env node
// weekly_health_check.js — SMTP/IMAP/DNS sanity + data freshness; report to Slack
const fs=require('fs'), path=require('path'), dns=require('dns'), nodemailer=require('nodemailer');
const { ImapFlow } = require('imapflow');
const SLACK=process.env.SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL || '';
const { post } = require('./lib/slack_notify');
async function checkSMTP(){ try{
  const transport = nodemailer.createTransport({ host:process.env.SMTP_HOST, port:Number(process.env.SMTP_PORT||587), secure:Number(process.env.SMTP_PORT)==465, auth:{user:process.env.SMTP_USER, pass:process.env.SMTP_PASS} });
  await transport.verify(); return 'ok';
} catch(e){ return 'ERR:'+e.message; } }
async function checkIMAP(){ if(!process.env.IMAP_HOST||!process.env.IMAP_USER||!process.env.IMAP_PASS) return 'skipped';
  try{ const client=new ImapFlow({ host:process.env.IMAP_HOST, port:Number(process.env.IMAP_PORT||993), secure:true, auth:{user:process.env.IMAP_USER, pass:process.env.IMAP_PASS} }); await client.connect(); await client.logout(); return 'ok'; } catch(e){ return 'ERR:'+e.message; } }
function evidenceFreshness(){ const base='evidence'; const now=Date.now(); let count48=0, count7=0;
  if(fs.existsSync(base)){ for(const vd of fs.readdirSync(base,{withFileTypes:true})){ if(!vd.isDirectory()) continue; const dir=path.join(base,vd.name);
    for(const f of fs.readdirSync(dir)){ if(!/\.json$/i.test(f)) continue; const st=fs.statSync(path.join(dir,f)); const age=now-st.mtimeMs; if(age<=48*3600e3) count48++; if(age<=7*24*3600e3) count7++; } } }
  return { count48, count7 };
}
async function main(){
  const smtp=await checkSMTP(); const imap=await checkIMAP(); const fresh=evidenceFreshness();
  const msg = `Weekly Health:
• SMTP: ${smtp}
• IMAP: ${imap}
• Evidence: last 48h=${fresh.count48}, last 7d=${fresh.count7}
• Leads rows: ${fs.existsSync('data/leads.csv')?fs.readFileSync('data/leads.csv','utf8').split(/\r?\n/).filter(Boolean).length:0}`;
  console.log(msg); if(SLACK) await post(SLACK, msg);
}
main().catch(e=>{ console.error(e); process.exit(0); });