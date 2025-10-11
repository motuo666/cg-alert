#!/usr/bin/env node
/**
 * poll_inbox.js（最终修复版）
 * - DRY 模式：直接 PASS（E2E 用）
 * - 非 DRY：imapflow + mailparser 扫描近 7 天邮件，识别退信，写到 data/bounces.csv
 * - 兼容 imapflow.download() 返回 Buffer/Stream/AsyncIterable 等所有形态
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.join(' ');
const DRY = /\b(--dry|--dry=1)\b/i.test(argv) || /^1|true$/i.test(process.env.DRY || '');
const IMAP_HOST   = process.env.IMAP_HOST;
const IMAP_PORT   = Number(process.env.IMAP_PORT || 993);
const IMAP_SECURE = String(process.env.IMAP_SECURE || 'true').toLowerCase() !== 'false';
const IMAP_USER   = process.env.IMAP_USER || process.env.SMTP_USER || process.env.MAIL_FROM || '';
const IMAP_PASS   = process.env.IMAP_PASS || process.env.SMTP_PASS || '';
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK || '';

const DATA_DIR = path.join(__dirname, '..', 'data');
const BOUNCES  = path.join(DATA_DIR, 'bounces.csv');
const LAST_POLL = path.join(DATA_DIR, 'last_poll.txt');

function say(...a){ console.log(...a); }
function die(msg){ console.error(msg); process.exit(1); }

(async () => {
  if (DRY) { say('DRY mode: skip IMAP connection (poll_inbox PASS)'); process.exit(0); }

  if (!IMAP_HOST || !IMAP_PORT) die('IMAP host/port missing');
  if (!IMAP_USER || !IMAP_PASS) die('IMAP creds missing');

  let ImapFlow, simpleParser;
  try { ImapFlow = require('imapflow').ImapFlow; } catch { die('Missing dependency: imapflow'); }
  try { simpleParser = require('mailparser').simpleParser; } catch { die('Missing dependency: mailparser'); }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_SECURE,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    const since  = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const uids   = await client.search({ since }, { uid: true, unseen: false });
    const picked = (uids || []).slice(-200);

    let bounces = 0;

    for (const uid of picked) {
      const dl  = await client.download(uid);
      const src = (dl && (dl.source ?? dl.content)) ?? dl;   // 兼容不同返回结构
      const buf = await toBuffer(src);                       // 统一转 Buffer
      const mail = await simpleParser(buf);                  // 再交给 mailparser

      const from = (mail.from && mail.from.text || '').toLowerCase();
      const subj = (mail.subject || '').toLowerCase();

      const isBounce =
        from.includes('mailer-daemon') ||
        from.includes('postmaster') ||
        subj.includes('delivery status notification') ||
        subj.includes('undeliverable') ||
        subj.includes('failure notice') ||
        subj.includes('bounce');

      if (isBounce) {
        bounces++;
        const toHdr =
          getHeader(mail, 'x-failed-recipients') ||
          getHeader(mail, 'final-recipient')     ||
          (mail.to && mail.to.text)              || '';

        appendBounce(toHdr, mail.subject || '(no subject)');

        if (SLACK_WEBHOOK) {
          try {
            await postSlack(
              SLACK_WEBHOOK,
              `📬 Inbound → Bounce noticed\n• user: \`${IMAP_USER}\`\n• to: ${toHdr || '(unknown)'}\n• subject: ${mail.subject || '(no subject)'}`
            );
          } catch {}
        }
      }
    }

    say(`poll_inbox: scanned=${picked.length}, bounces=${bounces}`);

    // 心跳：记录最后一次成功轮询时间
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(LAST_POLL, new Date().toISOString() + '\n', 'utf8');
    } catch {}

    lock.release();
    await client.logout();
    process.exit(0);
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();

/** 统一把任意形态的下载结果转成 Buffer（支持 Buffer/String/Uint8Array/Stream/AsyncIterable） */
async function toBuffer(input) {
  if (!input) return Buffer.alloc(0);
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === 'string') return Buffer.from(input);
  if (input instanceof Uint8Array) return Buffer.from(input);

  // AsyncIterable（imapflow 某些版本的 content/source）
  if (typeof input[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const c of input) {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
    return Buffer.concat(chunks);
  }

  // Node Readable stream
  if (typeof input.on === 'function') {
    return await new Promise((resolve, reject) => {
      const chunks = [];
      input.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      input.once('end',  () => resolve(Buffer.concat(chunks)));
      input.once('error', reject);
      if (typeof input.resume === 'function') { try { input.resume(); } catch {} }
    });
  }

  // 兜底：字符串化
  return Buffer.from(String(input));
}

function getHeader(mail, key) {
  try {
    const v = mail.headers.get(key);
    return (v && v.toString) ? v.toString() : (v || '');
  } catch { return ''; }
}
function appendBounce(recipient, subject){
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const line = `${(recipient||'').replace(/\s+/g,' ')},${new Date().toISOString()},${(subject||'').replace(/\s+/g,' ')}\n`;
    fs.appendFileSync(BOUNCES, line, 'utf8');
  } catch {}
}
async function postSlack(url, text){
  await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text }) })
    .catch(()=>{});
}
