// scripts/send_bulk.js
// 依赖：nodemailer, csv-parse, csv-stringify（工作流里按包名安装即可）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { personaFromRow, subjectFor } = require('./segment');

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL,
  SLACK_WEBHOOK_URL,
  MAX_SEND_PER_RUN = '30',
  MIN_DELAY_SEC = '45',
  MAX_DELAY_SEC = '90',
  PER_DOMAIN_CAP = '2',   // 每个收件域名本次最多几封
  DRY_RUN = '',
} = process.env;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !FROM_EMAIL) {
  console.error('Missing SMTP envs. Required: SMTP_HOST, SMTP_USER, SMTP_PASS, FROM_EMAIL');
  process.exit(1);
}

const leadsPath = path.join(__dirname, '..', 'data', 'leads.csv');
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const logPath = path.join(logsDir, `outreach-${new Date().toISOString().slice(0,10)}.jsonl`);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randInt(min, max) { return Math.floor(Math.random()*(max-min+1))+min; }
function domainOf(email){ return (email.split('@')[1]||'').toLowerCase().trim(); }
function abBucket(email){ const h = crypto.createHash('sha1').update(email).digest('hex'); return (parseInt(h.slice(0,2),16) % 2 === 0) ? 'A' : 'B'; }
function abSubject(base, bucket){ return bucket==='B' ? base.replace('alerts','change alerts (verifiable)') : base; }

function bodyFor(row, persona) {
  const company = row.company || row.domain || 'your team';
  const vendors = [row.vendor1, row.vendor2, row.vendor3].filter(Boolean).join(', ');
  return [
    `Hi ${company} team,`,
    ``,
    `We monitor public changes on your vendors (pricing, ToS/DPA, subprocessors, status) and send`,
    `verifiable evidence cards (URL + snippet + timestamp + hash).`,
    vendors ? `Examples aligned to your stack: ${vendors}.` : null,
    ``,
    `Plans: Portfolio (25) / Business (50) / Enterprise (200+).`,
    `SLO: P95 < 24h, false positives < 10%, one-click opt-out ≤ 72h.`,
    ``,
    `If useful, I can share last-30-day changes for your top vendors.`,
    `If not a fit, reply "No" and I’ll stop.`,
    ``,
    `— CG Alert`,
    `https://www.cg-alert.com/`,
  ].filter(Boolean).join('\n');
}

async function postSlack(text){
  if (!SLACK_WEBHOOK_URL) return;
  try { await fetch(SLACK_WEBHOOK_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text }) }); } catch {}
}

async function main(){
  const csvRaw = fs.readFileSync(leadsPath,'utf8');
  const rows = parse(csvRaw, { columns:true, skip_empty_lines:true });
  const pending = rows.filter(r => !['sent','bounced','replied','optout','invalid'].includes((r.status||'').toLowerCase()));

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT || 587), secure:false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const domainCount = {};
  let sent=0, skipped=0, errors=0;

  for (const row of pending){
    if (sent >= Number(MAX_SEND_PER_RUN)) break;

    const to = (row.email||'').trim();
    if (!to || !to.includes('@')) { skipped++; continue; }
    if (String(row.mx_ok||'').toLowerCase()==='false') { skipped++; continue; }
    const d = domainOf(to);
    domainCount[d] = domainCount[d]||0;
    if (domainCount[d] >= Number(PER_DOMAIN_CAP)) { skipped++; continue; }

    const persona = personaFromRow(row);
    const subj = abSubject(subjectFor(persona, row.company || row.domain || ''), abBucket(to));
    const mail = {
      from: FROM_EMAIL, to, subject: subj, text: bodyFor(row, persona),
      headers: {
        'List-Unsubscribe': `<mailto:${FROM_EMAIL}?subject=unsubscribe>`,
        'X-CG-Track': `lead:${row.domain || row.company || ''};seq:${row.seq||'S1'}`,
        'Precedence': 'bulk',
      },
    };

    try{
      if (DRY_RUN) console.log('[DRY_RUN] would send to', to);
      else await transporter.sendMail(mail);

      row.status='sent'; row.seq='S1';
      row.sent_at = new Date().toISOString();
      row.last_touch = row.sent_at;
      domainCount[d] += 1;
      fs.appendFileSync(logPath, JSON.stringify({ to, subj, ts: row.sent_at, seq:'S1' })+'\n');
      sent++;
      await sleep(randInt(Number(MIN_DELAY_SEC), Number(MAX_DELAY_SEC))*1000);
    }catch(e){
      errors++; row.status='error';
      row.notes=(row.notes||'')+` | send_error:${e.message}`;
      fs.appendFileSync(logPath, JSON.stringify({ to, error:e.message, ts:new Date().toISOString(), seq:'S1' })+'\n');
      await sleep(3000);
    }
  }

  fs.writeFileSync(leadsPath, stringify(rows,{header:true}), 'utf8');
  const summary = `Outreach S1: sent=${sent}, skipped=${skipped}, errors=${errors}, domains=${Object.keys(domainCount).length}`;
  console.log(summary); await postSlack(summary);
}
main().catch(async e=>{ console.error(e); await postSlack(`Outreach S1 failed: ${e.message}`); process.exit(1); });
