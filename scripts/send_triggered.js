#!/usr/bin/env node
/**
 * CG Alert — Outreach Sender (hardened)
 * - Headers: email,name,title,company,domain,region,status
 * - Reply-To, optional Return-Path (MAIL_RETURN_PATH)
 * - List-Unsubscribe (One-Click) + optional mailto fallback (LIST_UNSUB_MAILTO)
 * - Dedup across leads.csv + leads_enriched.csv
 * - Per-domain throttle (DOMAIN_LIMIT, default 2)
 * - Send spacing (SEND_SPACING_MS, default 1200ms)
 * - Retry (transient) + early abort guard
 * - Optional seed sends from data/seeds.csv (excluded from LIMIT)
 */
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs'); const path = require('path');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM || 'Jason — CG Alert <ops@cg-alert.com>';
const REPLY_TO = process.env.REPLY_TO || 'Jason <jason@cg-alert.com>';
const RETURN_PATH = process.env.MAIL_RETURN_PATH || '';
const LIST_UNSUB_MAILTO = process.env.LIST_UNSUB_MAILTO || ''; // e.g., unsub@cg-alert.com
const POSTAL = process.env.MAIL_POSTAL_ADDRESS || '—';
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const HMAC_SECRET = process.env.UNSUB_HMAC_SECRET || '';
const LIMIT = parseInt((process.argv.find(a=>a.startsWith('--limit='))||'--limit=12').split('=')[1], 10);
const DRY = !process.argv.some(a=>a==='--dry=false');

const DOMAIN_LIMIT = parseInt(process.env.DOMAIN_LIMIT || '2', 10);
const SEND_SPACING_MS = parseInt(process.env.SEND_SPACING_MS || '1200', 10);
const ERROR_ABORT_THRESHOLD = parseInt(process.env.ERROR_ABORT_THRESHOLD || '3', 10);
const ERROR_ABORT_WINDOW = parseInt(process.env.ERROR_ABORT_WINDOW || '10', 10);
const SEED_SEND = String(process.env.SEED_SEND || 'true').toLowerCase() !== 'false';

function hmac(e){ return crypto.createHmac('sha256', HMAC_SECRET).update(String(e)).digest('hex').slice(0,24); }
function loadCSV(p){
  if(!fs.existsSync(p)) return {head:[], rows:[]};
  const L=fs.readFileSync(p,'utf8').trim().split(/\r?\n/); if(L.length<2) return {head:[], rows:[]};
  const H=L.shift().split(',').map(s=>s.trim()); const rows=L.map(l=>{const a=l.split(','); const o={}; H.forEach((k,i)=>o[k]=a[i]||''); return o;});
  return {head:H, rows};
}
function uniqByEmail(rows){
  const seen=new Set(); const out=[];
  for(const r of rows){
    const e=String(r.email||'').toLowerCase();
    if(!e || seen.has(e)) continue; seen.add(e); out.push(r);
  }
  return out;
}
const base = loadCSV(path.join('data','leads.csv'));
const enriched = loadCSV(path.join('data','leads_enriched.csv'));
const seeds = loadCSV(path.join('data','seeds.csv')); // optional
let leads = uniqByEmail([...enriched.rows, ...base.rows]);

const supPath = path.join('data','suppressions.csv'); if(!fs.existsSync(supPath)) fs.writeFileSync(supPath,'email,reason,at\n');
const suppressed = new Set(fs.readFileSync(supPath,'utf8').split(/\r?\n/).slice(1).map(l=>l.split(',')[0].toLowerCase()).filter(Boolean));

const transport = (SMTP_HOST&&SMTP_USER&&SMTP_PASS) ? nodemailer.createTransport({host:SMTP_HOST, port:SMTP_PORT, secure:SMTP_PORT===465, auth:{user:SMTP_USER, pass:SMTP_PASS}}) : null;
const outDir = 'out'; fs.mkdirSync(outDir, {recursive:true});
const outLog = path.join(outDir,'outreach_log.csv'); if(!fs.existsSync(outLog)) fs.writeFileSync(outLog,'email,status,at\n');

function persona(title=''){
  const t = String(title||'').toLowerCase();
  if (/procurement|sourcing|buyer|purchas/.test(t)) return 'procurement';
  if (/legal|counsel|privacy|compliance|dpo|gc\b/.test(t)) return 'legal';
  if (/revops|revenue|sales ops|sales-ops/.test(t)) return 'revops';
  return 'general';
}
function emailDomain(e){ const m=String(e).split('@'); return m[1]||''; }

function body(row){
  const name = (row.name||'').trim(); const title = (row.title||'').trim();
  const company = (row.company||'').trim(); const domain = (row.domain||'').trim(); const region = (row.region||'').trim();
  const per = persona(title);
  const intro = {
    procurement: 'We track pricing/ToS/DPA/sub‑processors with timestamped evidence you can paste into renewal emails.',
    legal: 'We diff ToS/DPA/sub‑processors and ship verifiable change evidence for compliance and negotiation.',
    revops: 'We surface vendor pricing & terms changes that create leverage at renewal, with ready‑to‑paste language.',
    general: 'We monitor vendors for pricing and terms changes and deliver verifiable evidence you can act on.'
  }[per];

  const hi = name ? `Hi ${name},` : 'Hi there,';
  const reports = `${SITE}/reports/`;
  const unsub = `${SITE}/unsub?m=${encodeURIComponent(row.email)}&t=${hmac(row.email)}`;
  const preheader = 'Evidence‑backed vendor changes (pricing, ToS, DPA, subprocessors) — ready to use at renewal.';

  const html = `
<span style="display:none!important;opacity:0;color:transparent;max-height:0;overflow:hidden">${preheader}</span>
<p>${hi}</p>
<p>${intro}</p>
<p>${company ? `For ${company}` : 'For your top vendors'}${domain ? ` (e.g., ${domain})` : ''}${region ? ` in ${region}` : ''}, you can review recent captures here: <a href="${reports}">Reports</a>.</p>
<p>— CG Alert</p>
<hr><p style="font-size:12px;color:#666">${POSTAL}<br>Unsubscribe: <a href="${unsub}">${unsub}</a></p>`;

  const text = `${hi}\n\n${intro}\n\n${company ? `For ${company}` : 'For your top vendors'}${domain ? ` (e.g., ${domain})` : ''}${region ? ` in ${region}` : ''}, see Reports: ${reports}\n\n— CG Alert\n\nUnsubscribe: ${unsub}\n${POSTAL}`;

  return { html, text, unsub };
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function isTransient(err){
  const s = String(err && (err.code||err.response||err.message||err)).toLowerCase();
  return /(timeout|temporar|try again|4\d\d|connection closed|rate|throttle|greylist)/.test(s);
}

(async()=>{
  const domainCount = {};
  let attempts=0, errors=0, sent=0;

  for (const r of leads){
    const email = String(r.email||'').toLowerCase(); if(!email || suppressed.has(email)) continue;
    const dom = emailDomain(email);
    domainCount[dom] = (domainCount[dom]||0);
    if (DOMAIN_LIMIT>0 && domainCount[dom] >= DOMAIN_LIMIT) continue;

    const { html, text, unsub } = body(r);
    if (DRY){ fs.appendFileSync(outLog, `${email},DRY,${new Date().toISOString()}\n`); continue; }
    if (!transport){ fs.appendFileSync(outLog, `${email},ERROR_NO_SMTP,${new Date().toISOString()}\n`); continue; }

    const unsubHeaderParts = [];
    if (LIST_UNSUB_MAILTO) unsubHeaderParts.push(`<mailto:${LIST_UNSUB_MAILTO}>`);
    unsubHeaderParts.push(`<${unsub}>`);

    const headers = {
      'List-Unsubscribe': unsubHeaderParts.join(', '),
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
    const mail = {
      from: FROM,
      to: email,
      subject: 'Evidence-backed vendor change alerts — CG Alert',
      html, text, headers,
      envelope: RETURN_PATH ? { from: RETURN_PATH, to: email } : undefined,
      replyTo: REPLY_TO || undefined,
    };

    attempts++;
    try {
      try { await transport.sendMail(mail); }
      catch(e1){ if (isTransient(e1)){ await sleep(1500); await transport.sendMail(mail); } else throw e1; }
      fs.appendFileSync(outLog, `${email},SENT,${new Date().toISOString()}\n`);
      domainCount[dom]++; sent++; 
    } catch(e){
      errors++; 
      fs.appendFileSync(outLog, `${email},ERROR,${new Date().toISOString()}\n`);
      if (attempts <= ERROR_ABORT_WINDOW && errors >= ERROR_ABORT_THRESHOLD){
        console.error('abort early: too many early errors');
        break;
      }
    }
    if (sent >= LIMIT) break;
    if (SEND_SPACING_MS>0) await sleep(SEND_SPACING_MS);
  }

  if (SEED_SEND){
    const hdr = (seeds.head||[]).map(h=>h.toLowerCase());
    if (hdr.includes('email') && seeds.rows && seeds.rows.length){
      for(const s of seeds.rows){
        const email = String(s.email||'').toLowerCase(); if(!email) continue;
        const { html, text, unsub } = body({email, name:s.name||'', title:'', company:s.company||'', domain:'', region:''});
        try {
          if (!DRY && transport){
            const headers = { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post':'List-Unsubscribe=One-Click' };
            const mail = { from: FROM, to: email, subject: '[SEED] CG Alert outreach', html, text, headers,
              envelope: RETURN_PATH ? { from: RETURN_PATH, to: email } : undefined, replyTo: REPLY_TO || undefined };
            await transport.sendMail(mail);
          }
          fs.appendFileSync(outLog, `${email},SEED_SENT,${new Date().toISOString()}\n`);
        } catch(e){
          fs.appendFileSync(outLog, `${email},SEED_ERROR,${new Date().toISOString()}\n`);
        }
        if (SEND_SPACING_MS>0) await sleep(SEND_SPACING_MS);
      }
    }
  }

  console.log(JSON.stringify({sent, attempts, errors}));
})();