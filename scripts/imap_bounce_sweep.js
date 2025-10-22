/**
 * imap_bounce_sweep.js (production-grade)
 * - Incremental via KV meta:imap:last_uid
 * - LOOKBACK_HOURS widens detection window (default 168h)
 * - DSN-aware parsing (Final-Recipient / Original-Recipient / X-Failed-Recipients)
 * - Safe suppression: lead.bounced = true (status 原样保留)
 * - Observability counters
 */
import { ImapFlow } from "imapflow";
import API from "./lib/cfkv.js";

const {
  IMAP_HOST, IMAP_USER, IMAP_PASS,
  CF_ACCOUNT_ID, KV_NAMESPACE_ID, CF_API_TOKEN,
  LOOKBACK_HOURS
} = process.env;

if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) throw new Error("Missing IMAP_*");
if (!CF_ACCOUNT_ID || !KV_NAMESPACE_ID || !CF_API_TOKEN) throw new Error("Missing CF KV creds");

const kv = API(CF_ACCOUNT_ID, KV_NAMESPACE_ID, CF_API_TOKEN);
const META_KEY = "meta:imap:last_uid";

const SUBJECT_HINTS = [
  "undelivered", "delivery", "returned", "failure", "bounced",
  "mail delivery subsystem", "mail delivery failed", "delayed", "warning"
];

const BODY_HINTS = [
  "550", "5.1.1", "5.7.1", "user unknown", "no such user",
  "mailbox unavailable", "host unknown", "blocked", "quota exceeded"
];

function extractEmailsFreeText(text) {
  const set = new Set();
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let m; while ((m = re.exec(text)) !== null) set.add(m[0].toLowerCase());
  return set;
}

function extractFromDSN(text) {
  // RFC3464 DSN blocks
  const set = new Set();
  const reFinal = /Final-Recipient:\s*[^;]+;\s*([^\s;]+)/gi;
  const reOrig  = /Original-Recipient:\s*[^;]+;\s*([^\s;]+)/gi;
  const reXFail = /X-Failed-Recipients:\s*([^\s;]+)/gi;
  let m;
  while ((m = reFinal.exec(text)) !== null) set.add(m[1].toLowerCase());
  while ((m = reOrig.exec(text)) !== null)  set.add(m[1].toLowerCase());
  while ((m = reXFail.exec(text)) !== null) set.add(m[1].toLowerCase());
  return set;
}

async function readMessageRaw(client, uid) {
  const dl = await client.download(uid);
  const chunks = [];
  for await (const ch of dl.content) chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
  return Buffer.concat(chunks).toString("utf-8");
}

function looksLikeBounce(headersLower, subjectLower, bodyLower) {
  if (headersLower.includes("from: mailer-daemon") || headersLower.includes("from: postmaster")) return true;
  if (SUBJECT_HINTS.some(k => subjectLower.includes(k))) return true;
  if (bodyLower.includes("message/delivery-status")) return true;
  if (BODY_HINTS.some(k => bodyLower.includes(k))) return true;
  return false;
}

async function main() {
  const lookbackH = Number(LOOKBACK_HOURS || 168);
  const since = new Date(Date.now() - lookbackH * 60 * 60 * 1000);

  const client = new ImapFlow({
    host: IMAP_HOST, port: 993, secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  let totalScanned = 0, totalConsidered = 0, totalSuppressed = 0;
  try {
    const lastUidText = await kv.get(META_KEY);
    const lastUid = lastUidText ? Number(lastUidText) : 0;

    // Broad search first; we will filter again in code for robustness.
    const uids = await client.search(
      { since, or: [
          ['FROM', 'MAILER-DAEMON'],
          ['FROM', 'postmaster'],
          ['SUBJECT', 'undelivered'],
          ['SUBJECT', 'delivery'],
          ['SUBJECT', 'returned'],
          ['SUBJECT', 'failure'],
          ['SUBJECT', 'bounced']
        ]},
      { uid: true }
    );

    for (const uid of uids) {
      if (uid <= lastUid) continue;
      const raw = await readMessageRaw(client, uid);
      totalScanned++;

      const lower = raw.toLowerCase();
      const headerEnd = raw.indexOf("\r\n\r\n") >= 0 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
      const headers = headerEnd > 0 ? raw.slice(0, headerEnd) : raw;
      const body = headerEnd > 0 ? raw.slice(headerEnd + 2) : raw;

      const subjectMatch = headers.match(/subject:\s*(.*)/i);
      const subjectLower = subjectMatch ? subjectMatch[1].toLowerCase() : "";

      const isBounce = looksLikeBounce(headers.toLowerCase(), subjectLower, lower);
      if (!isBounce) continue;
      totalConsidered++;

      // Merge candidates from DSN fields + free text
      const emails = new Set([
        ...extractFromDSN(raw),
        ...extractEmailsFreeText(raw)
      ]);

      for (const e of emails) {
        const key = `lead:${e}`;
        const value = await kv.get(key);
        if (!value) continue; // 不是我们库里的邮箱，跳过
        try {
          const lead = JSON.parse(value);
          if (!lead.bounced) {
            lead.bounced = true;             // 抑制位
            lead.updated_at = new Date().toISOString();
            // 保留原 status（"new"|"verified"|"unsub"），避免与你的发信状态机冲突
            await kv.put(key, JSON.stringify(lead));
            totalSuppressed++;
          }
        } catch { /* ignore broken JSON */ }
      }

      // 仅在处理完本 UID 后推进游标
      await kv.put(META_KEY, String(uid));
    }

  } finally {
    lock.release();
    await client.logout();
  }

  console.log(JSON.stringify({
    ok: true,
    lookback_h: lookbackH,
    total_scanned: totalScanned,
    total_considered: totalConsidered,
    total_suppressed: totalSuppressed
  }));
}

main().catch(e => { console.error(e); process.exit(1); });
