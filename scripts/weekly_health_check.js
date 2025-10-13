#!/usr/bin/env node
// weekly_health_check.js — 带阈值的健康检查：证据/KPI + SMTP/IMAP，失败 exit 1 并推 Slack
const fs=require('fs'), path=require('path'), nodemailer=require('nodemailer'); const { ImapFlow } = require('imapflow');
const SLACK=process.env.SLACK_WEBHOOK||''; const KPI_48H=Number(process.env.KPI_48H_MIN||8); const KPI_7D=Number(process.env.KPI_7D_MIN||25);
function postSlack(text){ if(!SLACK) return Promise.resolve(); return fetch(SLACK,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})}).catch(()=>{}); }
async function checkSMTP(){ try{ const t=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:Number(process.env.SMTP_PORT)==465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}); await t.verify(); return 'ok'; }catch(e){ return 'ERR:'+e.message; } }
async function checkIMAP(){ if(!process.env.IMAP_HOST||!process.env.IMAP_USER||!process.env.IMAP_PASS) return 'skipped'; try{ const c=new ImapFlow({host:process.env.IMAP_HOST,port:Number(process.env.IMAP_PORT||993),secure:true,auth:{user:process.env.IMAP_USER,pass:process.env.IMAP_PASS}}); await c.connect(); await c.logout(); return 'ok'; }catch(e){ return 'ERR:'+e.message; } }
function evidenceFresh(){ const base='evidence'; const now=Date.now(); let n48=0,n7=0; if(fs.existsSync(base)){ for(const vd of fs.readdirSync(base,{withFileTypes:true})){ if(!vd.isDirectory()) continue; const dir=path.join(base,vd.name);
  for(const f of fs.readdirSync(dir)){ if(!/\.json$/i.test(f)) continue; const mt=fs.statSync(path.join(dir,f)).mtimeMs; const age=now-mt; if(age<=48*3600e3) n48++; if(age<=7*24*3600e3) n7++; } } } return {n48,n7}; }
(async function main(){
  const smtp=await checkSMTP(); const imap=await checkIMAP(); const ev=evidenceFresh();
  const ok = ev.n48>=KPI_48H && ev.n7>=KPI_7D && smtp==='ok';
  const msg = `Health Check
• SMTP: ${smtp}
• IMAP: ${imap}
• Evidence: 48h=${ev.n48}/${KPI_48H}, 7d=${ev.n7}/${KPI_7D}
• Leads: ${fs.existsSync('data/leads.csv')?fs.readFileSync('data/leads.csv','utf8').split(/\r?\n/).filter(Boolean).length:0}
• Status: ${ok?'OK ✅':'FAIL 🔴'}`;
  console.log(msg); await postSlack(msg); if(!ok) process.exit(1);
})().catch(e=>{ console.error(e); process.exit(1); });
