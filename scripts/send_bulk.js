#!/usr/bin/env node
/**
 * send_bulk.js
 * - 读取 data/s1_subject.txt & data/s1.html 作为模板
 * - leads.csv（9列）过滤 {status ∉ unsub/optout/bounced/invalid}
 * - 支持 --limit --dry
 * - nodemailer 池化 + 限速；List-Unsubscribe 头；可选 BCC
 * - 链接选择：vendors/<slug>/ 优先；否则 /updates/?utm=outreach_s1
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const argv = require('minimist')(process.argv.slice(2), { boolean: ['dry'], string: ['limit'], default: { dry: true, limit: '20' } });

const { SMTP_HOST, SMTP_PORT = 587, SMTP_USER, SMTP_PASS, MAIL_FROM, BCC_TO } = process.env;

function read(p, fallback=''){ try { return fs.readFileSync(p,'utf8'); } catch { return fallback; } }
function lines(p){ return read(p).split(/\r?\n/).filter(Boolean); }
function parseLeadsRow(row){
  const arr = row.split(',');
  if (arr.length < 9) return null;
  return {
    email: arr[0].trim(), company: arr[1].trim(), domain: arr[2].trim(),
    vendors: [arr[3].trim(), arr[4].trim(), arr[5].trim()].filter(Boolean),
    persona: arr[6].trim(), status: arr[7].trim(), mx_ok: arr[8].trim()==='1'
  };
}
function sampleURLForLead(lead){
  for (const slug of lead.vendors) {
    const p = path.join('vendors', slug, 'index.html');
    if (fs.existsSync(p)) return `https://www.cg-alert.com/vendors/${encodeURIComponent(slug)}/`;
  }
  return `https://www.cg-alert.com/updates/?utm=outreach_s1`;
}
function personalize(html, lead){
  return html.replace(/\{\{company\}\}/g, lead.company || lead.domain || 'your team')
             .replace(/\{\{sample_url\}\}/g, sampleURLForLead(lead));
}
function readLeads(){
  const p = path.join('data','leads.csv');
  if (!fs.existsSync(p)) return [];
  return lines(p).map(parseLeadsRow).filter(Boolean)
    .filter(x => !['unsub','optout','bounced','invalid','bad-mx'].includes(x.status));
}

async function main(){
  const dry = !!argv.dry;
  const limit = Number(argv.limit);

  const subject = read(path.join('data','s1_subject.txt'), 'Evidence-backed vendor changes for you');
  const htmlTpl = read(path.join('data','s1.html'), '<p>Hi {{company}}, see {{sample_url}}</p>');
  const leads = readLeads().slice(0, limit);
  if (leads.length === 0) { console.log('[bulk] no eligible leads'); return; }

  const transport = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT), secure: Number(SMTP_PORT) === 465,
    pool: true, maxConnections: 2, maxMessages: 50, rateDelta: 60000, rateLimit: 120,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  const headers = {
    'List-Unsubscribe': `<mailto:${MAIL_FROM}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  };

  let sent = 0;
  for (const lead of leads) {
    const html = personalize(htmlTpl, lead);
    if (dry) {
      console.log(`[dry] ${lead.email} ← ${subject}`);
      continue;
    }
    try {
      await transport.sendMail({
        from: MAIL_FROM, to: lead.email, bcc: BCC_TO || undefined,
        subject, html, headers
      });
      sent++;
    } catch (e) {
      console.error('[send][err]', lead.email, e.message);
    }
  }
  if (!dry) await transport.close();
  const dt = new Date().toISOString();
  fs.appendFileSync(path.join('data','sent_log.csv'), `${dt},bulk,${sent},${subject.replace(/,/g,';')}\n`);
  fs.writeFileSync(path.join('data','last_outreach.txt'), `${dt} bulk sent=${sent}\n`);
  console.log(`[bulk] done: sent=${sent}/${leads.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
