// scripts/bounce_sweep.js (imapflow with diagnostics, CommonJS)
const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');

const { IMAP_HOST, IMAP_USER, IMAP_PASS, DEBUG_IMAPFLOW } = process.env;
if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) {
  console.log('skip: missing IMAP_*'); // soft-skip; do not fail pipeline
  process.exit(0);
}

const supPath = path.join('data', 'suppressions.csv');
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

const log = (...args) => console.log('[bounce]', ...args);
const debug = (...args) => { if (DEBUG_IMAPFLOW === '1') console.log('[imapflow]', ...args); };

// Bounce heuristics
const BOUNCE_HINTS = [
  /mail delivery/i,
  /undeliver/i,
  /failure notice/i,
  /mailer-daemon/i,
  /delivery status notification/i,
  /status:\s*5\d\d/i
];

function uniqSorted(arr) { return [...new Set(arr)].sort(); }

function extractEmails(raw) {
  const list = [];
  const pushList = (arr) => arr && arr.forEach(s => { if (s) list.push(String(s).toLowerCase()); });

  // Delivery-status fields
  const rx = (re) => (raw.match(re) || []).map(l => (l.split(/[:;]\s*/)[2] || l.split(/[:;]\s*/)[1] || '').trim());
  pushList(rx(/Final-Recipient:[^\n\r]+/ig));
  pushList(rx(/Original-Recipient:[^\n\r]+/ig));

  // Common headers
  pushList(((raw.match(/X-Failed-Recipients:[^\n\r]+/ig)) || []).flatMap(l => (l.split(':')[1]||'').split(/[ ,;]/)));
  pushList(((raw.match(/Undelivered-To:[^\n\r]+/ig)) || []).flatMap(l => (l.split(':')[1]||'').split(/[ ,;]/)));

  // Fallback
  pushList((raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) || []);

  return uniqSorted(list.filter(e => /@/.test(e) && !/mailer-daemon|postmaster/i.test(e)));
}

(async () => {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: DEBUG_IMAPFLOW === '1' ? console : false,
    clientInfo: { name: 'cg-alert/bounce-sweep', version: '1.1.0' }
  });

  try {
    log('connecting', IMAP_HOST, 'as', IMAP_USER);
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    const candidates = new Set();
    try {
      for await (let msg of client.fetch({ seen: false }, { envelope: true, source: true })) {
        const from = (msg.envelope && msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].address) || '';
        const raw = msg.source ? msg.source.toString('utf8') : '';
        const isBounce = BOUNCE_HINTS.some(r => r.test(raw)) || /mailer-daemon/i.test(from);
        if (!isBounce) continue;
        extractEmails(raw).forEach(e => candidates.add(e));
      }
    } finally {
      lock.release();
    }
    await client.logout();

    if (!candidates.size) {
      log('no bounces found');
      process.exit(0);
    }

    ensureDir(path.dirname(supPath));
    const prev = fs.existsSync(supPath) ? fs.readFileSync(supPath, 'utf8').split(/\r?\n/).filter(Boolean) : [];
    const prevSet = new Set(prev.map(x => x.split(',')[0].trim().toLowerCase()));
    const merged = uniqSorted([...prevSet, ...candidates]);

    fs.writeFileSync(supPath, merged.join('\n') + '\n');
    log(`suppressions size=${merged.length}`);
  } catch (e) {
    // Try to make the real cause visible
    const msg = e && (e.response || e.message || e.code || String(e));
    console.error('bounce sweep error:', msg);
    if (/AUTH|LOGIN|Invalid credentials|Command failed/i.test(String(msg))) {
      console.error('HINT: IMAP auth failed or server rejected LOGIN. Use app-specific password or IMAP password.');
    }
    process.exit(4);
  }
})();
