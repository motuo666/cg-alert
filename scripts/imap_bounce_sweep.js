/**
 * imap_bounce_sweep.js
 * Reads IMAP inbox, finds bounces, flags CF KV leads as bounced
 * Env: IMAP_HOST, IMAP_USER, IMAP_PASS, CF_ACCOUNT_ID, KV_NAMESPACE_ID, CF_API_TOKEN
 */
import { ImapFlow } from "imapflow";
import API from "./lib/cfkv.js";

const {
  IMAP_HOST, IMAP_USER, IMAP_PASS,
  CF_ACCOUNT_ID, KV_NAMESPACE_ID, CF_API_TOKEN
} = process.env;

if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) throw new Error("Missing IMAP_*");
if (!CF_ACCOUNT_ID || !KV_NAMESPACE_ID || !CF_API_TOKEN) throw new Error("Missing CF KV creds");

const kv = API(CF_ACCOUNT_ID, KV_NAMESPACE_ID, CF_API_TOKEN);
const META_KEY = "meta:imap:last_uid";

function extractEmails(text) {
  const set = new Set();
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let m; while ((m = re.exec(text)) !== null) set.add(m[0].toLowerCase());
  return Array.from(set);
}

async function main() {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const lastUidText = await kv.get(META_KEY);
    const lastUid = lastUidText ? Number(lastUidText) : 0;

    // search recent possible bounces
    const since = new Date(Date.now() - 1000 * 60 * 60 * 72); // 72h
    const list = await client.search(
      { since, from: ["MAILER-DAEMON", "postmaster"], subject: ["Undelivered", "delivery", "returned", "failure", "bounced"] },
      { uid: true }
    );

    for (const uid of list) {
      if (uid <= lastUid) continue;
      const msg = await client.download(uid);
      const chunks = [];
      for await (const ch of msg.content) chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
      const raw = Buffer.concat(chunks).toString("utf-8");

      const emails = extractEmails(raw);
      for (const e of emails) {
        const key = `lead:${e}`;
        const value = await kv.get(key);
        if (!value) continue;
        const lead = JSON.parse(value);
        lead.bounced = true;
        lead.status = "suppressed";
        lead.updated_at = new Date().toISOString();
        await kv.put(key, JSON.stringify(lead));
        console.log("Suppressed bounced:", e);
      }
      await kv.put(META_KEY, String(uid));
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
