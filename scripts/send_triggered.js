#!/usr/bin/env node
/**
 * Outreach Sender (email-only) with template A/B support and ramp guard.
 * CSV headers: email,name,title,company,domain,region,status
 */
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs'); const path = require('path');

const DRY = (process.env.DRY || 'true').toLowerCase() === 'true';
let LIMIT = parseInt(process.env.SEND_LIMIT || '12', 10);
const SEND_SPACING_MS = parseInt(process.env.SEND_SPACING_MS || '0', 10);
const REGION_FILTER = (process.env.REGION_FILTER || '').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM || 'Jason — CG Alert <ops@cg-alert.com>';
const REPLY_TO = process.env.REPLY_TO || 'Jason <ops@cg-alert.com>';
const RETURN_PATH = process.env.MAIL_RETURN_PATH || '';
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const UNSUB_ORIGIN = process.env.UNSUB_ORIGIN || SITE;
const UNSUB_HMAC_SECRET = process.env.UNSUB_HMAC_SECRET || 'dev';

// Ramp guard (optional config)
try {
  const rampCfg = JSON.parse(fs.readFileSync('config/ramp.json','utf8'));
  if (rampCfg && rampCfg.max && Number.isFinite(rampCfg.max)) {
    LIMIT = Math.min(LIMIT, rampCfg.max);
  }
} catch (_) {}

function readCSV(file){
  const txt = fs.readFileSync(file, 'utf8').replace(/\r\n/g,'\n').trim();
  if(!txt) return [];
  const [head, ...rows] = txt.split('\n').filter(Boolean);
  const cols = head.split(',').map(s=>s.trim());
  return rows.map(r => {
    const vals = r.split(','); const o = {};
    cols.forEach((c, i)=> o[c] = (vals[i]||'').trim());
    return o;
  });
}

function hmac(s){ return crypto.createHmac('sha256', UNSUB_HMAC_SECRET).update(String(s)).digest('hex'); }

function loadTemplate(){
  const htmlPath = 'config/outreach_active.html';
  const txtPath  = 'config/outreach_active.txt';
  if (fs.existsSync(htmlPath) || fs.existsSync(txtPath)) {
    return {
      html: fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath,'utf8') : '',
      text: fs.existsSync(txtPath) ? fs.readFileSync(txtPath,'utf8') : ''
    };
  }
  // fallback default
  return {
    html: `<p>We monitor vendor <b>Pricing/ToS/DPA/Subprocessors/SLA</b> with evidence cards (URL · timestamp · SHA256).</p>
<p>Use at renewal to push back on uplifts or terms. — Jason @ CG Alert</p>`,
    text: `We monitor vendor Pricing/ToS/DPA/Subprocessors/SLA with evidence cards (URL · timestamp · SHA256). Use at renewal.`
  };
}

function personalize(tpl, r, unsub){
  const rep = (s) => s
    .replace(/\{\{name\}\}/g, r.name || '')
    .replace(/\{\{company\}\}/g, r.company || '')
    .replace(/\{\{domain\}\}/g, r.domain || '')
    .replace(/\{\{unsub\}\}/g, unsub);
  return { html: rep(tpl.html) + `<p style="font-size:12px;color:#666">Unsubscribe: <a href="${unsub}">${unsub}</a></p>`, text: rep(tpl.text) + `\nUnsub: ${unsub}` };
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async function main(){
  const leadsPath = 'data/leads.csv';
  if(!fs.existsSync(leadsPath)){ console.log('no leads.csv'); process.exit(0); }
  const leads = readCSV(leadsPath);

  let suppress = new Set();
  const supPath = 'data/suppressions.csv';
  if(fs.existsSync(supPath)){
    fs.readFileSync(supPath,'utf8').split(/\r?\n/).forEach(l=>{ const e=String(l).trim().toLowerCase(); if(e) suppress.add(e); });
  }

  const tpl = loadTemplate();
  const filtered = [];
  for(const r of leads){
    const email = String(r.email||'').toLowerCase();
    if(!email) continue;
    if(suppress.has(email)) continue;
    if(REGION_FILTER.length>0){
      const reg = String(r.region||'').toLowerCase();
      if(reg && !REGION_FILTER.includes(reg)) continue;
    }
    filtered.push(r);
  }

  const take = filtered.slice(0, LIMIT);
  let transport = null;
  if(!DRY){
    transport = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT===465, auth: {user: SMTP_USER, pass: SMTP_PASS} });
  }

  let sent = 0, attempts = 0, errors = 0;
  for(const r of take){
    attempts++;
    const unsub = `${UNSUB_ORIGIN}/unsubscribe/?u=${encodeURIComponent(r.email)}&s=${hmac(r.email)}`;
    const { html, text } = personalize(tpl, r, unsub);
    try{
      if(!DRY && transport){
        const headers = { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
        const mail = {
          from: FROM, to: r.email, subject: 'Evidence-backed vendor change alerts', html, text, headers,
          envelope: RETURN_PATH ? { from: RETURN_PATH, to: r.email } : undefined, replyTo: REPLY_TO || undefined
        };
        await transport.sendMail(mail);
      }
      sent++;
      if(SEND_SPACING_MS>0) await sleep(SEND_SPACING_MS);
    }catch(e){ errors++; }
  }
  // log for metrics aggregator
  const mdir = 'data/metrics'; fs.mkdirSync(mdir,{recursive:true});
  const line = `${new Date().toISOString()},outreach,attempts=${attempts},sent=${sent},dry=${DRY}\n`;
  fs.appendFileSync(`${mdir}/events.log`, line);
  console.log(`done. sent=${sent} dry=${DRY}`);
})();
