// scripts/bounce_sweep.js (imapflow version, CommonJS)
const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');

const { IMAP_HOST, IMAP_USER, IMAP_PASS } = process.env;
if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) {
  console.log('skip: missing IMAP_*'); // do not fail the workflow if unset
  process.exit(0);
}

const supPath = path.join('data', 'suppressions.csv');
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

// very conservative bounce heuristics
const BOUNCE_HINTS = [
  /mail delivery/i,
  /undeliver/i,
  /failure notice/i,
  /mailer-daemon/i,
  /delivery status notification/i,
  /status:\s*5\d\d/i
];

function uniqSorted(arr) {
  return [...new Set(arr)].sort();
}

function extractEmails(raw) {
  const list = [];
  // Priority 1: delivery-status fields
  const pr1 = raw.match(/Final-Recipient:\s*(?:rfc822;\s*)?([^\s;<>\r\n]+)/ig) || [];
  pr1.forEach(l => {
    const m = l.match(/Final-Recipient:\s*(?:rfc822;\s*)?([^\s;<>\r\n]+)/i);
    if (m && m[1]) list.push(m[1].toLowerCase());
  });
  const pr1b = raw.match(/Original-Recipient:\s*(?:rfc822;\s*)?([^\s;<>\r\n]+)/ig) || [];
  pr1b.forEach(l => {
    const m = l.match(/Original-Recipient:\s*(?:rfc822;\s*)?([^\s;<>\r\n]+)/i);
    if (m && m[1]) list.push(m[1].toLowerCase());
  });
  // Priority 2: X-Failed-Recipients / Undelivered-To
  const pr2 = raw.match(/X-Failed-Recipients:\s*([^\r\n]+)/ig) || [];
  pr2.forEach(l => {
    (l.split(':')[1] || '').split(/[ ,;]/).forEach(x => {
      if (/@/.test(x)) list.push(x.trim().toLowerCase());
    });
  });
  const pr2b = raw.match(/Undelivered-To:\s*([^\r\n]+)/ig) || [];
  pr2b.forEach(l => {
    (l.split(':')[1] || '').split(/[ ,;]/).forEach(x => {
      if (/@/.test(x)) list.push(x.trim().toLowerCase());
    });
  });
  // Fallback: any email-like string
  const any = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  any.forEach(x => list.push(x.toLowerCase()));
  // Filter obvious noise
  return uniqSorted(list.filter(e =>
    !/mailer-daemon|postmaster|amazonaws\.com|amazonses\.com/i.test(e)
  ));
}

(async () => {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
    clientInfo: { name: 'cg-alert/bounce-sweep', version: '1.0.0' }
  });

  await client.connect();
  let lock = await client.getMailboxLock('INBOX');
  const candidates = new Set();
  try {
    // unread messages first
    for await (let msg of client.fetch({ seen: false }, { envelope: true, source: true })) {
      const from = (msg.envelope && msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].address) || '';
      const raw = msg.source ? msg.source.toString('utf8') : '';
      const isBounce = BOUNCE_HINTS.some(r => r.test(raw)) || /mailer-daemon/i.test(from);
      if (!isBounce) continue;
      extractEmails(raw).forEach(e => candidates.add(e));
    }
  } finally {
    lock.release();
    await client.logout();
  }

  if (!candidates.size) {
    console.log('no bounces found');
    process.exit(0);
  }

  ensureDir(path.dirname(supPath));
  const prev = fs.existsSync(supPath) ? fs.readFileSync(supPath, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const prevSet = new Set(prev.map(x => x.split(',')[0].trim().toLowerCase()));
  const merged = uniqSorted([...prevSet, ...candidates]);

  // keep simple: first column email; outreach_send.js only reads first column
  const body = merged.map(e => e).join('\\n') + '\\n';
  fs.writeFileSync(supPath, body);
  console.log(`suppressions size=${merged.length}`);
})().catch(e => {
  console.error('bounce sweep error:', e && e.message ? e.message : e);
  process.exit(4);
});
