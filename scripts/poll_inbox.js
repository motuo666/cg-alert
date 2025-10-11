#!/usr/bin/env node
/**
 * poll_inbox.js (覆盖版)
 * - DRY 模式：不加载依赖，直接通过（用于 E2E）
 * - 非 DRY：用 imapflow + mailparser 连接 IMAP，扫描最近 7 天邮件，识别退信并写入 data/bounces.csv（若存在）
 * - IMAP_USER/PASS 缺失时自动回退到 SMTP_USER/PASS 或 MAIL_FROM（用户名）
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.join(' ');
const DRY = /\b(--dry|--dry=1)\b/i.test(argv) || /^1|true$/i.test(process.env.DRY || '');
const ONCE = /\b(--once|--once=1)\b/i.test(argv) || true; // 本脚本默认单次轮询即可

// 读取 env，提供回退
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
  // DRY：直接通过，用于 E2E
  if (DRY) { 
    say('DRY mode: skip IMAP connection (poll_inbox PASS)'); 
    process.exit(0); 
  }

  // 基本必填
  if (!IMAP_HOST || !IMAP_PORT) die('IMAP host/port missing');
  if (!IMAP_USER || !IMAP_PASS) die('IMAP creds missing'); // 非 DRY 必须有

  // 延迟加载依赖（只有在非 DRY 时需要）
  let ImapFlow, simpleParser;
  try {
    ImapFlow = require('imapflow').ImapFlow;
  } catch (e) { die('Missing dependency: imapflow'); }
  try {
    simpleParser = require('mailparser').simpleParser;
  } catch (e) { die('Missing dependency: mailparser'); }

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

    // 查最近 7 天的未读 + 最近 200 封（双保险）
    const since = new Date(Date.now() - 7*24*3600*1000);
    const uids = await client.search({ since }, { uid: true, unseen: false });
    const picked = (uids || []).slice(-200);

    let bounces = 0;
    for (const uid of picked) {
      const { source } = await client.download(uid);
      const buf = await streamToBuffer(source);
      const mail = await simpleParser(buf);

      const from = (mail.from && mail.from.text || '').toLowerCase();
      const subj = (mail.subject || '').toLowerCase();

      // 粗略识别退信/失败通知（够用）
      const isBounce = from.includes('mailer-daemon') || from.includes('postmaster') ||
                       subj.includes('delivery status notification') ||
                       subj.includes('undeliverable') ||
                       subj.includes('failure notice') ||
                       subj.includes('bounce');

      if (isBounce) {
        bounces++;
        const toHdr = header(mail, 'x-failed-recipients') || header(mail, 'final-recipient') || (mail.to && mail.to.text) || '';
        appendBounce(toHdr, subj);

        if (SLACK_WEBHOOK) {
          // 轻量发送（失败不阻塞主流程）
          try {
            await postSlack(SLACK_WEBHOOK, `📬 Inbound → Bounce noticed\n• user: \`${IMAP_USER}\`\n• to: ${toHdr || '(unknown)'}\n• subject: ${mail.subject || '(no subject)'}`);
          } catch {}
        }
      }
    }

    say(`poll_inbox: scanned=${picked.length}, bounces=${bounces}`);
    lock.release();
    await client.logout();
    process.exit(0);
  } catch (e) {
    console.error(e.stack || e.message);
    process.exit(1);
  }
})();

function header(mail, key) {
  try {
    return (mail.headers.get(key) || '').toString();
  } catch { return ''; }
}
function streamToBuffer(stream){
  return new Promise((resolve, reject)=>{
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', ()=> resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
function appendBounce(recipient, subject){
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const line = `${(recipient||'').replace(/\s+/g,' ')},${new Date().toISOString()},${(subject||'').replace(/\s+/g,' ')}\n`;
    fs.appendFileSync(BOUNCES, line, 'utf8');
  } catch {}
}
async function postSlack(url, text){
  // Node 18 自带 fetch
  await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text }) });
}
