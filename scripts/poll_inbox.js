#!/usr/bin/env node
/**
 * poll_inbox.js (修复版)
 * - DRY 模式直接 PASS（用于 E2E）
 * - 非 DRY：用 imapflow + mailparser 扫描近 7 天入站邮件，识别退信，写入 data/bounces.csv
 * - 自动用 SMTP_* 作为 IMAP_* 的回退（若未单独提供）
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.join(' ');
const DRY = /\b(--dry|--dry=1)\b/i.test(argv) || /^1|true$/i.test(process.env.DRY || '');
const ONCE = true; // 单次轮询

// env & fallback
const IMAP_HOST   = process.env.IMAP_HOST;
const IMAP_PORT   = Number(process.env.IMAP_PORT || 993);
const IMAP_SECURE = String(process.env.IMAP_SECURE || 'true').toLowerCase() !== 'false';
const IMAP_USER   = process.env.IMAP_USER || process.env.SMTP_USER || process.env.MAIL_FROM || '';
const IMAP_PASS   = process.env.IMAP_PASS || process.env.SMTP_PASS || '';

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK || '';
const DATA_DIR = path.join(__dirname, '..', 'data');
const BOUNCES = path.join(DATA_DIR, 'bounces.csv');

function say(...a){ console.log(...a); }
function die(msg){ console.error(msg); process.exit(1); }

(async () => {
  if (DRY) {
    say('DRY mode: skip IMAP connection (poll_inbox PASS)');
    process.exit(0);
  }

  if (!IMAP_HOST || !IMAP_PORT) die('IMAP host/port missing');
  if (!IMAP_USER || !IMAP_PASS) die('IMAP creds missing');

  // 延迟加载依赖
  let ImapFlow, simpleParser;
  try { ImapFlow = require('imapflow').ImapFlow; }
  catch { die('Missing dependency: imapflow'); }
  try { simpleParser = require('mailparser').simpleParser; }
  catch { die('Missing dependency: mailparser'); }

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

    const since = new Date(Date.now() - 7*24*3600*1000);
    const uids = await client.search({ since }, { uid: true, unseen: false });
    const picked = (uids || []).slice(-200);

    let bounces = 0;

    for (const uid of picked) {
      // 关键改动：兼容 source/content/Buffer/AsyncIterable/Stream
      const res = await client.download(uid);
      const src = (res && (res.source || res.content)) || res;

      // 直接交给 mailparser，内部会根据类型处理
      const mail = await simpleParser(src);

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
          getHeader(mail, 'final-recipient') ||
          (mail.to && mail.to.text) || '';

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
    lock.release();
    await client.logout();
    process.exit(0);
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();

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
  await fetch(url, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ text })
  }).catch(()=>{});
}
