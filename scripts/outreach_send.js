// scripts/outreach_send.js (CommonJS auto-discovery, Email-only)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { findFirst, readCSVGuess, log } = require('./utils.js');

const DRY = (process.env.DRY || 'true') === 'true';
const LIMIT = parseInt(process.env.LIMIT || '20', 10);
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';

function hmac(token){
  return crypto.createHmac('sha256', process.env.UNSUB_HMAC_SECRET || 'dev').update(token).digest('hex');
}

const leadsPath = findFirst(['data/leads.csv','leads.csv']);
let leads = [{email:'buyer@example.com', name:'Buyer', title:'Procurement Lead', company:'Acme', domain:'acme.com', region:'US', status:'new'}];
if(leadsPath){
  try { const rows = readCSVGuess(leadsPath); leads = rows.filter(r => r.email); log('loaded leads:', leads.length, 'from', leadsPath); }
  catch(e){ log('leads.csv parse failed, fallback to demo', e.message); }
}

const suppressPath = findFirst(['data/suppressions.csv']);
const suppressed = new Set();
if(suppressPath){
  try{
    const txt = fs.readFileSync(suppressPath, 'utf8');
    txt.split(/\r?\n/).forEach(line=>{
      const m = line.split(',')[0];
      if(m && m.includes('@')) suppressed.add(m.trim().toLowerCase());
    });
    log('loaded suppressions:', suppressed.size);
  }catch(e){ log('no suppressions parsed'); }
}

function buildHtml(lead, unsubUrl){
  return `Hi ${lead.name || 'there'},<br><br>
We monitor <b>Pricing</b>, <b>Terms/SLA</b>, <b>DPA</b>, <b>Subprocessors</b>, <b>Status</b> with <b>evidence cards</b> (URL · timestamp · SHA256) and ready‑to‑paste escalation language.<br><br>
Plans: Portfolio $2,988 (25 vendors), Business $6,000 (50 vendors), Enterprise $18k+ (200 vendors).<br>
See details: <a href="${SITE}">cg-alert.com</a><br><br>
Unsubscribe: <a href="${unsubUrl}">opt out</a>`;
}

async function main(){
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 587, secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  let sent = 0;
  for(const lead of leads){
    if(sent >= LIMIT) break;
    if(!lead.email) continue;
    if(suppressed.has((lead.email||'').toLowerCase())) continue;
    if((lead.status||'').toLowerCase()==='optout') continue;

    const uid = `${lead.email}:${Date.now()}`;
    const token = hmac(uid);
    const unsub = `${SITE}/unsubscribe/?u=${encodeURIComponent(uid)}&s=${token}`;
    const subject = `Evidence-backed vendor change alerts for ${lead.company || lead.domain || ''}`.trim();
    const html = buildHtml(lead, unsub);
    const msg = {
      from: process.env.SMTP_USER,
      replyTo: process.env.REPLY_TO || `"Jason" <ops@cg-alert.com>`,
      to: lead.email,
      subject, html
    };
    if(DRY){ console.log('[DRY] would send to', lead.email, 'unsub=', unsub); }
    else { await transporter.sendMail(msg); console.log('sent', lead.email); }
    sent++;
  }
  log('done. sent=', sent, 'dry=', DRY);
}
main().catch(e=>{ console.error(e); process.exit(1); });
