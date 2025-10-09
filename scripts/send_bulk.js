// scripts/send_bulk.js
// 读取 data/leads.csv，按天配额发送 S1；记录到 data/outreach_log.csv，防重复。
// 依赖：nodemailer, csv-parse, csv-stringify（workflow 已安装）

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const nodemailer = require('nodemailer');

const DRY = process.env.DRY_RUN === '1';
const leadsPath = 'data/leads.csv';
const logPath = 'data/outreach_log.csv';
const tmplPath = 'templates/s1.md';

function ensureFile(p, header) {
  if (!fs.existsSync(p)) fs.writeFileSync(p, header + '\n');
}

ensureFile(leadsPath, 'email,company,domain,vendor1,vendor2,vendor3');
ensureFile(logPath, 'ts,email,stage,result,msg');

const leads = parse(fs.readFileSync(leadsPath), { columns: true, skip_empty_lines: true });
const sentLog = parse(fs.readFileSync(logPath), { columns: true, skip_empty_lines: true });

const sentSet = new Set(sentLog.filter(r => r.stage === 'S1' && r.result === 'OK').map(r => r.email.toLowerCase()));

const dailyCap = Number(process.env.S1_DAILY_CAP || 40);
const batch = [];

for (const row of leads) {
  const email = (row.email || '').trim().toLowerCase();
  if (!email || sentSet.has(email)) continue;
  batch.push(row);
  if (batch.length >= dailyCap) break;
}

if (batch.length === 0) {
  console.log('No S1 targets. Exit.');
  process.exit(0);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const from = `${process.env.FROM_NAME || 'CG Alert'} <${process.env.FROM_EMAIL}>`;
const replyTo = process.env.REPLY_TO || process.env.FROM_EMAIL;

function renderTemplate(tmpl, row) {
  return tmpl
    .replaceAll('{{company}}', row.company || '')
    .replaceAll('{{domain}}', row.domain || '')
    .replaceAll('{{vendor1}}', row.vendor1 || '')
    .replaceAll('{{vendor2}}', row.vendor2 || '')
    .replaceAll('{{vendor3}}', row.vendor3 || '');
}

const fallback = `Hi {{company}} team,

We monitor public changes on {{vendor1}}{{vendor2?}}, and provide verifiable evidence cards (Pricing/ToS/DPA/Subprocessors/Status).
If you'd like "set-and-forget" alerts for your stack (e.g. {{vendor1}}, {{vendor2}}, {{vendor3}}), here’s the 2-min overview:
https://www.cg-alert.com/

— CG Alert
`;

const tmpl = fs.existsSync(tmplPath) ? fs.readFileSync(tmplPath, 'utf8') : fallback;

(async () => {
  const rowsToAppend = [];
  for (const row of batch) {
    const email = row.email.trim();
    const subject = `Quick check: public changes on ${row.vendor1 || 'your suppliers'}`;
    const text = renderTemplate(tmpl, row);

    try {
      if (!DRY) {
        await transporter.sendMail({ from, to: email, replyTo, subject, text });
      }
      rowsToAppend.push({ ts: new Date().toISOString(), email, stage: 'S1', result: 'OK', msg: '' });
      console.log('Sent S1 ->', email);
      await new Promise(r => setTimeout(r, 3000)); // 3s 间隔，稳妥
    } catch (e) {
      rowsToAppend.push({ ts: new Date().toISOString(), email, stage: 'S1', result: 'ERR', msg: String(e).slice(0,200) });
      console.error('ERR S1 ->', email, e.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  const appended = stringify(rowsToAppend, { header: false });
  fs.appendFileSync(logPath, appended);
})();
