#!/usr/bin/env node
// scripts/follow_up.js — S2/S3低频跟进（兼容 MAIL_FROM / FROM_EMAIL，兼容 SLACK_WEBHOOK/SLACK_WEBHOOK_URL）
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const env = process.env;
const SMTP_HOST = env.SMTP_HOST;
const SMTP_PORT = Number(env.SMTP_PORT || 587);
const SMTP_USER = env.SMTP_USER;
const SMTP_PASS = env.SMTP_PASS;
// 统一发件人：优先 MAIL_FROM，兼容旧 FROM_EMAIL
const FROM = env.MAIL_FROM || env.FROM_EMAIL;
// 兼容两种 Slack 变量名
const SLACK = env.SLACK_WEBHOOK_URL || env.SLACK_WEBHOOK;

const MAX_SEND_PER_RUN = Number(env.MAX_SEND_PER_RUN || 25);
const MIN_DELAY_SEC    = Number(env.MIN_DELAY_SEC || 45);
const MAX_DELAY_SEC    = Number(env.MAX_DELAY_SEC || 90);
const PER_DOMAIN_CAP   = Number(env.PER_DOMAIN_CAP || 2);
const DAYS_SINCE_S1    = Number(env.DAYS_SINCE_S1 || 4);
const DRY_RUN          = String(env.DRY_RUN || '');

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function domainOf(email){ return (email.split('@')[1]||'').toLowerCase().trim(); }
async function postSlack(text){
  if(!SLACK) return;
  try {
    await fetch(SLACK, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text }) });
  } catch {}
}
function daysBetween(iso){
  if(!iso) return 999;
  const t = new Date(String(iso)).getTime();
  if(!t) return 999;
  return Math.floor((Date.now()-t)/(1000*3600*24));
}

const leadsPath = path.join(__dirname,'..','data','leads.csv');
const logsDir = path.join(__dirname,'..','logs'); if(!fs.existsSync(logsDir)) fs.mkdirSync(logsDir,{recursive:true});
const logPath = path.join(logsDir, `followup-${new Date().toISOString().slice(0,10)}.jsonl`);

function subject2(company){ return `Quick follow-up on vendor change alerts for ${company}`; }
function body2(company){
  return [
    `Hi ${company} team,`,
    ``,
    `Circling back on vendor change alerts (pricing, ToS/DPA, subprocessors).`,
    `I can share a 30-day snapshot for your top vendors — evidence-backed with URLs & timestamps.`,
    ``,
    `If relevant, reply with 3–5 vendors you care most about. Happy to send a sample CSV.`,
    ``,
    `Best,`,
    `CG Alert`
  ].join('\n');
}

function loadLeads(){
  if(!fs.existsSync(leadsPath)) return [];
  const raw = fs.readFileSync(leadsPath,'utf8').replace(/^\uFEFF/,'');
  const rows = raw.split(/\r?\n/).filter(Boolean).map(l=>l.split(','));
  // leads.csv: email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok
  return rows.map(a=>{
    if(a.length < 9) return null;
    return {
      email: (a[0]||'').trim().toLowerCase(),
      company: (a[1]||'').trim(),
      domain: (a[2]||'').trim().toLowerCase(),
      vendors: [a[3],a[4],a[5]].map(x=>String(x||'').trim()).filter(Boolean),
      persona: (a[6]||'').trim(),
      status:  (a[7]||'').trim(),
      mx_ok:   String(a[8]||'0').trim()==='1'
    };
  }).filter(Boolean);
}

function loadS1Log(){
  const f = path.join(__dirname,'..','data','sent_log.csv');
  if(!fs.existsSync(f)) return new Map();
  const m = new Map();
  for(const line of fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean)){
    const [ts, type, count, subject] = line.split(',');
    m.set(ts, { type, count:Number(count||0), subject });
  }
  return m;
}

(async function main(){
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !FROM) {
    console.error('Missing SMTP envs or FROM/MAIL_FROM');
    process.exit(1);
  }
  const transport = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT===465,
    pool: true, maxConnections: 2, maxMessages: 50, socketTimeout: 60000, rateLimit: 120,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  const all = loadLeads().filter(x => x.mx_ok && !['unsub','optout','bounced','invalid','bad-mx'].includes(x.status));
  if(!all.length){ console.log('[followup] no eligible leads'); process.exit(0); }

  // 轻约束：同域限额
  const perDomain = new Map();
  const pick = [];
  for(const r of all){
    const d = domainOf(r.email);
    const used = perDomain.get(d)||0;
    if(used >= PER_DOMAIN_CAP) continue;
    perDomain.set(d, used+1);
    pick.push(r);
    if(pick.length >= MAX_SEND_PER_RUN) break;
  }

  let sent = 0;
  for(const row of pick){
    const to = row.email;
    const company = row.company || row.domain || 'your team';
    const mail = {
      from: FROM,
      to,
      subject: subject2(company),
      text: body2(company),
      headers: {
        'List-Unsubscribe': `<mailto:${FROM}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    };

    if (String(DRY_RUN).toLowerCase()==='true') {
      console.log(`[dry] ${to} ← ${mail.subject}`);
    } else {
      try { await transport.sendMail(mail); sent++; }
      catch(e){ console.error('[followup][err]', to, e.message); }
      await sleep(randInt(MIN_DELAY_SEC*1000, MAX_DELAY_SEC*1000));
    }
  }

  try { await transport.close(); } catch {}
  console.log(`[followup] sent=${sent}/${pick.length}`);
  if(sent) await postSlack(`Follow-up sent: ${sent}/${pick.length}`);
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
