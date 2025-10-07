// scripts/outreach_health.js (debug版)
// 统计最近24h 已发送/退信，发 Slack 概览；打印详细错误（包含 AggregateError 子错误）

const { ImapFlow } = require('imapflow');

const IMAP_HOST = process.env.IMAP_HOST;
const IMAP_PORT = +process.env.IMAP_PORT || 993;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASS = process.env.IMAP_PASS;
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;
const DEBUG = process.env.DEBUG === '1';

const SENT_BOX = process.env.IMAP_SENT_BOX || 'Sent';
const BOUNCE_FROM_RE = new RegExp(
  process.env.IMAP_BOUNCE_FROM || '(mailer-daemon|postmaster|Mail Delivery Subsystem|no-reply@bounce)',
  'i'
);

const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

function ok(v){ return v!==undefined && v!==null && String(v).trim()!==''; }

async function postSlack(text){
  try{
    await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  }catch(e){
    console.error('Slack post failed:', e);
  }
}

async function countBox(client, mailbox) {
  if (DEBUG) console.log('Opening mailbox:', mailbox);
  await client.mailboxOpen(mailbox, { readOnly: true });
  let count = 0;
  for await (let msg of client.fetch({ since }, { envelope: true, internalDate: true })) count++;
  return count;
}

function formatAggErr(e){
  if(!e) return '';
  let out = `${e.name||'Error'}: ${e.message||e}`;
  if(e.code) out += ` [code=${e.code}]`;
  if(Array.isArray(e.errors) && e.errors.length){
    out += `\nCauses:`;
    for(const c of e.errors){
      out += `\n - ${(c && (c.message||c)) || c}`;
      if(c && c.code) out += ` [code=${c.code}]`;
    }
  }
  if(e.stack) out += `\n${e.stack}`;
  return out;
}

async function main() {
  // 0) 环境自检
  const missing = [];
  if(!ok(IMAP_HOST)) missing.push('IMAP_HOST');
  if(!ok(IMAP_PORT)) missing.push('IMAP_PORT');
  if(!ok(IMAP_USER)) missing.push('IMAP_USER');
  if(!ok(IMAP_PASS)) missing.push('IMAP_PASS');
  if(!ok(SLACK_WEBHOOK)) missing.push('SLACK_WEBHOOK');
  if(missing.length){
    const msg = `Outreach Health config missing: ${missing.join(', ')}`;
    console.error(msg);
    await postSlack(`Outreach Health error: ${msg}`);
    process.exit(1);
  }
  if (DEBUG){
    console.log('ENV OK:', {
      IMAP_HOST, IMAP_PORT,
      IMAP_USER_present: !!IMAP_USER,
      IMAP_PASS_present: !!IMAP_PASS,
      SLACK_WEBHOOK_present: !!SLACK_WEBHOOK
    });
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: DEBUG ? console : undefined,
    tls: { servername: IMAP_HOST } // 避免某些环境SNI问题
  });

  let sentCount = 0, bounceCount = 0;

  try{
    if (DEBUG) console.log('Connecting IMAP...');
    await client.connect();

    // Sent
    try {
      sentCount = await countBox(client, SENT_BOX);
    } catch {
      sentCount = await countBox(client, 'Sent Items');
    }

    // Bounces in INBOX
    await client.mailboxOpen('INBOX', { readOnly: true });
    for await (let msg of client.fetch({ since }, { envelope: true, internalDate: true })){
      const from =
        (msg.envelope.from &&
          msg.envelope.from[0] &&
          (msg.envelope.from[0].address || msg.envelope.from[0].name)) || '';
      const subj = msg.envelope.subject || '';
      if (BOUNCE_FROM_RE.test(from) || /delivery[ -]?status|undeliver|failure/i.test(subj)) bounceCount++;
    }

    const rate = sentCount ? (bounceCount / sentCount) * 100 : 0;
    const text = [
      '*Outreach Health (24h)*',
      `• Sent: ${sentCount}`,
      `• Bounces: ${bounceCount}`,
      `• Bounce rate: ${rate.toFixed(2)}%`,
      rate >= 2 ? '→ ⚠️ 建议暂停扩量（先禁用 S1 的 schedule）' : '→ ✅ 正常'
    ].join('\n');
    await postSlack(text);

  }catch(e){
    const detail = formatAggErr(e);
    console.error(detail);
    await postSlack(`Outreach Health error:\n${detail}`);
    process.exit(1);
  }finally{
    try{ await client.logout(); }catch(_){}
  }
}

main();
