#!/usr/bin/env node
/**
 * poll_inbox.js
 * - 近7天退信轮询；识别 bounce 并写 data/bounces.csv
 * - IMAP_* 未配置 => 直接跳过（不报错，保持主链路可用）
 */
const fs = require('fs');
const path = require('path');

const { IMAP_HOST, IMAP_PORT = '993', IMAP_USER, IMAP_PASS } = process.env;

if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) {
  console.log('[poll_inbox] IMAP not configured; skip.');
  process.exit(0);
}

async function main() {
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host: IMAP_HOST, port: Number(IMAP_PORT), secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
  });

  await client.connect();
  try {
    await client.mailboxOpen('INBOX');
    const since = new Date(Date.now() - 7*24*3600*1000);
    const seq = await client.search({ since });
    for await (let msg of client.fetch(seq, { envelope: true, source: true })) {
      const src = msg.source.toString();
      if (/Status:\s*5\.\d+\.\d+/i.test(src) || /Delivery[ -]Status Notification/i.test(src) || /Mail delivery failed/i.test(src)) {
        const rcpt = (src.match(/Final-Recipient:\s*rfc822;(.*)/i) || src.match(/Original-Recipient:\s*rfc822;(.*)/i) || [,'unknown'])[1].trim();
        const reason = (src.match(/Diagnostic-Code:(.*)/i) || [,'bounce'])[1].trim().replace(/,/g,';');
        fs.appendFileSync(path.join('data','bounces.csv'), `${rcpt},${reason},${new Date(msg.envelope.date).toISOString()}\n`);
      }
    }
  } finally {
    await client.logout().catch(()=>{});
  }
}

main().catch(err => { console.error('[poll_inbox] ERROR:', err.message || err); process.exit(0); });
