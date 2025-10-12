#!/usr/bin/env node
// poll_inbox.js — quietly skip if IMAP not configured; append basic bounces if present
const fs=require('fs'), path=require('path'); const { ImapFlow } = require('imapflow');
const { IMAP_HOST, IMAP_PORT='993', IMAP_USER, IMAP_PASS } = process.env;
if(!IMAP_HOST || !IMAP_USER || !IMAP_PASS){ console.log('[poll_inbox] IMAP not configured; skip'); process.exit(0); }
(async function main(){
  const client=new ImapFlow({ host:IMAP_HOST, port:Number(IMAP_PORT), secure:true, auth:{user:IMAP_USER, pass:IMAP_PASS} });
  await client.connect(); await client.mailboxOpen('INBOX');
  const since = new Date(Date.now() - 7*24*3600e3); const seq = await client.search({ since });
  for await (const m of client.fetch(seq, { envelope:true, source:true })) {
    const src = m.source.toString(); if(!/Delivery|Status Notification|Mail delivery failed|Diagnostic-Code/i.test(src)) continue;
    const rcpt = (src.match(/Final-Recipient:\s*rfc822;(.*)/i)||src.match(/Original-Recipient:\s*rfc822;(.*)/i)||[, 'unknown'])[1].trim();
    const reason = (src.match(/Diagnostic-Code:(.*)/i)||[, 'bounce'])[1].trim().replace(/,/g,';');
    fs.appendFileSync(path.join('data','bounces.csv'), `${rcpt},${reason},${new Date(m.envelope.date).toISOString()}\n`);
  }
  await client.logout();
})().catch(e=>{ console.error('[poll_inbox] ERR', e.message); process.exit(0); });