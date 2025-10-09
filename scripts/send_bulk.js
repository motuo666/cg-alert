// scripts/send_bulk.js
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const nodemailer = require('nodemailer');

const CSV_PATH = 'data/leads.csv';
const SUBJECT_PATH = 'data/s1_subject.txt';
const HTML_PATH = 'data/s1.html';

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
  MAIL_FROM, S1_SUBJECT, DRY_RUN = '0'
} = process.env;

function readFileOrNull(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function loadCsv() {
  if (!fs.existsSync(CSV_PATH)) throw new Error('缺失 data/leads.csv');
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true });
  return rows;
}

function saveCsv(rows) {
  const header = ['email','company','domain','vendor1','vendor2','vendor3','status','last_error','last_sent'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map(k => (r[k] ?? '').toString().replace(/\n/g,' ')).join(','));
  }
  fs.writeFileSync(CSV_PATH, lines.join('\n'));
}

function pickPending(rows) {
  return rows.filter(r => {
    const st = (r.status || '').toLowerCase();
    return !st || st === 'new' || st === 'retry';
  });
}

async function getTransport() {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) throw new Error('缺少 SMTP_* secrets');
  const secure = Number(SMTP_PORT) === 465;
  return nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT), secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false }
  });
}

function getSubject() {
  return (S1_SUBJECT || readFileOrNull(SUBJECT_PATH) || '').trim();
}

function getHtml() {
  return readFileOrNull(HTML_PATH);
}

(async () => {
  const rows = loadCsv();
  const pending = pickPending(rows);
  if (!pending.length) { console.log('✅ 无待发送行'); process.exit(0); }

  const subject = getSubject();
  const html = getHtml();
  if (!subject) throw new Error('缺少主题：请在 Repository Variables 设置 S1_SUBJECT 或提供 data/s1_subject.txt');
  if (!html) throw new Error('缺少正文模板：请提供 data/s1.html（保持你现有文案）');

  console.log(`准备发送：${pending.length} 封；DRY_RUN=${DRY_RUN}`);
  const t = await getTransport();
  const now = new Date().toISOString();

  for (const r of pending) {
    try {
      if (DRY_RUN !== '1') {
        await t.sendMail({
          from: MAIL_FROM || SMTP_USER,
          to: r.email,
          subject,
          html,
        });
      }
      r.status = 'sent';
      r.last_error = '';
      r.last_sent = now;
      console.log(`✅ ${r.email}`);
    } catch (e) {
      r.status = 'err';
      r.last_error = (e && e.message) ? e.message.slice(0,200) : 'unknown';
      console.log(`❌ ${r.email} :: ${r.last_error}`);
    }
  }
  saveCsv(rows);
  console.log('✅ 完成回写 CSV');
})().catch(e => { console.error('❌ 发送失败:', e.message); process.exit(1); });
