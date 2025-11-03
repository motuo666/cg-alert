// scripts/bounce_sweep.js (imapflow version, CommonJS)
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

const HINTS = [/mail delivery/i,/undeliver/i,/failure notice/i,/mailer-daemon/i,/delivery status notification/i,/status:\s*5\d\d/i];

function uniqSorted(arr){ return [...new Set(arr)].sort(); }

function extractEmails(raw){
  const out = [];
  const p1 = raw.match(/Final-Recipient:\s*(?:rfc822;\s*)?([^\s;<>\r\n]+)/ig) || [];
  p1.forEach(l => { const m = l.match(/Final-Recipient:\s*(?:rfc822;\s*)?([^\s;<>\r\n]+)/i); if(m && m[1]) out.push(m[1].toLowerCase()); });
  const p1b = raw.match(/Original-Recipient:\s*(?:rfc822;\s*)?([^\s;<>\r\n]+)/ig) || [];
  p1b.forEach(l => { const m = l.match(/Original-Recipient:\s*(?:rfc822;\s*)?([^\s;<>\r\n]+)/i); if(m && m[1]) out.push(m[1].toLowerCase()); });
  const p2 = raw.match(/X-Failed-Recipients:\s*([^\r\n]+)/ig) || [];
  p2.forEach(l => { (l.split(':')[1]||'').split(/[ ,;]/).forEach(x=>{ if(/@/.test(x)) out.push(x.trim().toLowerCase()); }); });
  const p2b = raw.match(/Undelivered-To:\s*([^\r\n]+)/ig) || [];
  p2b.forEach(l => { (l.split(':')[1]||'').split(/[ ,;]/).forEach(x=>{ if(/@/.test(x)) out.push(x.trim().toLowerCase()); }); });
  const any = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  any.forEach(x=> out.push(x.toLowerCase()));
  return uniqSorted(out.filter(e => !/mailer-daemon|postmaster|amazonses\.com|amazonaws\.com/i.test(e)));
}

(async () => {
  const client = new ImapFlow({ host: IMAP_HOST, port: 993, secure: true, auth: { user: IMAP_USER, pass: IMAP_PASS }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  const candidates = new Set();
  try {
    for await (let msg of client.fetch({ seen: false }, { envelope: true, source: true })) {
      const from = msg.envelope?.from?.[0]?.address || '';
      const raw = msg.source ? msg.source.toString('utf8') : '';
      const isBounce = HINTS.some(r=>r.test(raw)) || /mailer-daemon/i.test(from);
      if (!isBounce) continue;
      extractEmails(raw).forEach(e => candidates.add(e));
    }
  } finally {
    lock.release();
    await client.logout();
  }

  if (!candidates.size) { log('no bounces found'); process.exit(0); }

  ensureDir(require('path').dirname(supPath));
  const prev = require('fs').existsSync(supPath) ? require('fs').readFileSync(supPath,'utf8').split(/\r?\n/).filter(Boolean) : [];
  const prevSet = new Set(prev.map(x => x.split(',')[0].trim().toLowerCase()));
  const merged = uniqSorted([...prevSet, ...candidates]);

  require('fs').writeFileSync(supPath, merged.join('\\n') + '\\n');
  log(`suppressions size=${merged.length}`);
})().catch(e => {
  const msg = e && (e.response || e.message || e.code || String(e));
  console.error('bounce sweep error:', msg);
  process.exit(4);
});
