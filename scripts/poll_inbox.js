#!/usr/bin/env node
/**
 * poll_inbox.js
 * - DRY：跳过 IMAP 直 PASS（用于 E2E）
 * - 非 DRY：用 imapflow + mailparser 扫描近 7 天邮件，识别退信并追加到 data/bounces.csv
 * - IMAP_* 缺失时自动回退到 SMTP_* / MAIL_FROM（用户名）
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.join(' ');
const DRY  = /\b(--dry|--dry=1)\b/i.test(argv) || /^1|true$/i.test(process.env.DRY || '');
const ONCE = true; // 本脚本默认单次轮询

// ------- 环境变量（含回退） -------
const IMAP_HOST   = process.env.IMAP_HOST || (process.env.SMTP_HOST ? process.env.SMTP_HOST.replace(/^smtp\./i,'imap.') : '');
const IMAP_PORT   = Number(process.env.IMAP_PORT || 993);
const IMAP_SECURE = String(process.env.IMAP_SECURE || 'true').toLowerCase() !== 'false';
const IMAP_USER   = process.env.IMAP_USER || process.env.SMTP_USER || process.env.MAIL_FROM || '';
const IMAP_PASS   = process.env.IMAP_PASS || process.env.SMTP_PASS || '';

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK || '';
const DATA_DIR = path.join(__dirname, '..', 'data');
const BOUNCES  = path.join(DATA_DIR, 'bounces.csv');

function say(...a){ console.log(...a); }
function die(msg){ console.error(msg); process.exit(1); }

// ------- 主逻辑 -------
(async () => {
  if (DRY) {
    say('DRY mode: skip IMAP connection (poll_inbox PASS)');
    process.exit(0);
  }

  if (!IMAP_HOST || !IMAP_PORT) die('IMAP host/port missing');
  if (!IMAP_USER || !IMAP_PASS) die('IMAP creds missing');

  // 延迟加载依赖
  let ImapFlow, simpleParser;
  try { ImapFlow = require('imapflow').ImapFlow; } catch { die('Missing dependency: imapflow'); }
  try { simpleParser = require('mailparser').simpleParser; } catch { die('Missing dependency: mailparser'); }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_SECURE,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    const since = new Date(Date.now() - 7*24*3600*1000);
    const uids  = await client.search({ since }, { uid: true, unseen: false });
    const picked = (uids || []).slice(-200);

    let bounces = 0;

    for (const uid of picked) {
      const { source } = await client.download(uid);
      const buf  = await toBuffer(source);       // 兼容 Buffer/Stream/Async-Iterable
      const mail = await simpleParser(buf);

      const from = (mail.from && mail.from.text || '').toLowerCase();
      const subj = (mail.subject || '').toLowerCase();

      const isBounce =
        from.includes('mailer-daemon') || from.includes('postmaster') ||
        subj.includes('delivery status notification') ||
        subj.includes('undeliverable') ||
        subj.includes('failure notice') ||
        subj.includes('bounce');

      if (isBounce) {
        bounces++;
        const toHdr =
          header(mail, 'x-failed-recipients') ||
          header(mail, 'final-recipient') ||
          (mail.to && mail.to.text) || '';

        appendBounce(toHdr, mail.subject || '');

        if (SLACK_WEBHOOK) {
          postSlack(SLACK_WEBHOOK,
            `📬 Inbound → Bounce noticed\n• user: \`${IMAP_USER}\`\n• to: ${toHdr || '(unknown)'}\n• subject: ${mail.subject || '(no subject)'}`
          ).catch(()=>{});
        }
      }
    }

    say(`poll_inbox: scanned=${picked.length}, bounces=${bounces}`);
    lock.release();
    await client.logout();
    process.exit(0);
  } catch (e) {
    console.error(e && e.stack || e);
    process.exit(1);
  }
})();

// ------- 工具函数 -------
function header(mail, key) {
  try { return (mail.headers.get(key) || '').toString(); }
  catch { return ''; }
}

async function toBuffer(src) {
  // 1) 已是 Buffer
  if (Buffer.isBuffer(src)) return src;

  // 2) Node Readable Stream（兼容 .on/.pipe）
  if (src && typeof src.on === 'function') {
    return new Promise((resolve, reject) => {
      const chunks = [];
      src.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      src.on('end',  () => resolve(Buffer.concat(chunks)));
      src.on('error', reject);
    });
  }

  // 3) Async Iterable（ImapFlow 可能返回）
  if (src && typeof src[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const c of src) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  }

  // 4) ArrayBuffer / Uint8Array
  if (src && (src instanceof ArrayBuffer || ArrayBuffer.isView(src))) {
    return Buffer.from(src);
  }

  throw new Error('Unsupported source type from imapflow.download()');
}

function appendBounce(recipient, subject) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const needHeader = !fs.existsSync(BOUNCES);
    const line = `${CSV(recipient)} , ${new Date().toISOString()} , ${CSV(subject)}\n`;
    if (needHeader) fs.appendFileSync(BOUNCES, `recipient , ts , subject\n`, 'utf8');
    fs.appendFileSync(BOUNCES, line, 'utf8');
  } catch {}
}

function CSV(s) {
  const v = String(s || '').replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return `"${v}"`;
}

async function postSlack(url, text) {
  // Node 18 内置 fetch
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}
