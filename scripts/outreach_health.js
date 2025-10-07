// scripts/outreach_health.js
// 统计最近24h 已发送/退信，发 Slack 概览
const { ImapFlow } = require('imapflow');

const IMAP_HOST = process.env.IMAP_HOST;
const IMAP_PORT = +process.env.IMAP_PORT || 993;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASS = process.env.IMAP_PASS;
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;

const SENT_BOX = process.env.IMAP_SENT_BOX || 'Sent';
const BOUNCE_FROM_RE = new RegExp(
  process.env.IMAP_BOUNCE_FROM || '(mailer-daemon|postmaster|Mail Delivery Subsystem|no-reply@bounce)',
  'i'
);

const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

async function countBox(client, mailbox) {
  await client.mailboxOpen(mailbox, { readOnly: true });
  let count = 0;
  for await (let msg of client.fetch({ since }, { envelope: true, internalDate: true })) {
    count++;
  }
  return count;
}

async function main() {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS }
  });
  await client.connect();

  // 1) Sent 数量（Zoho 有时叫 Sent Items，做一次回退）
  let sentCount = 0;
  try {
    sentCount = await countBox(client, SENT_BOX);
  } catch {
    sentCount = await countBox(client, 'Sent Items');
  }

  // 2) 退信：在 INBOX 中找 From/Subject 像退信的
  await client.mailboxOpen('INBOX', { readOnly: true });
  let bounceCount = 0;
  for await (let msg of client.fetch({ since }, { envelope: true, internalDate: true })) {
    const from =
      (msg.envelope.from &&
        msg.envelope.from[0] &&
        (msg.envelope.from[0].address || msg.envelope.from[0].name)) ||
      '';
    const subj = msg.envelope.subject || '';
    if (BOUNCE_FROM_RE.test(from) || /delivery[ -]?status|undeliver|failure/i.test(subj)) {
      bounceCount++;
    }
  }

  const rate = sentCount ? (bounceCount / sentCount) * 100 : 0;

  const text = [
    '*Outreach Health (24h)*',
    `• Sent: ${sentCount}`,
    `• Bounces: ${bounceCount}`,
    `• Bounce rate: ${rate.toFixed(2)}%`,
    rate >= 2 ? '→ ⚠️ 建议暂停扩量（先禁用 S1 的 schedule）' : '→ ✅ 正常'
  ].join('\n');

  await fetch(SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  await client.logout();
}

main().catch(async (e) => {
  try {
    await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `Outreach Health error: ${e}` })
    });
  } catch {}
  process.exit(1);
});
