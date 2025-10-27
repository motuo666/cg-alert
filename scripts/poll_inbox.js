#!/usr/bin/env node
/**
 * poll_inbox.js
 *
 * Connects to IMAP and harvests bounces / complaints / unsubscribes.
 * Safe mode: if IMAP_* env missing, exit 0 without throwing.
 */

const fs = require("fs");
const path = require("path");
let ImapFlow;
try { ImapFlow = require("imapflow").ImapFlow; } catch(_){}

const {
  IMAP_HOST,
  IMAP_PORT,
  IMAP_USER,
  IMAP_PASS
} = process.env;

async function main(){
  fs.mkdirSync("data",{recursive:true});
  const bPath = path.join("data","bounces.csv");
  const cPath = path.join("data","complaints.csv");
  const uPath = path.join("data","unsubscribes.csv");
  for (const p of [bPath,cPath,uPath]) {
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, "email,timestamp,source\n","utf8");
    }
  }

  if (!IMAP_HOST || !IMAP_PORT || !IMAP_USER || !IMAP_PASS || !ImapFlow) {
    console.log("[poll_inbox] IMAP not configured, skip");
    return;
  }

  try {
    const client = new ImapFlow({
      host: IMAP_HOST,
      port: Number(IMAP_PORT),
      secure: true,
      auth: { user: IMAP_USER, pass: IMAP_PASS }
    });
    await client.connect();
    await client.mailboxOpen("INBOX");
    for await (const msg of client.fetch({seen:false}, {envelope:true, source:true})) {
      const from = (msg.envelope && msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].address) || "";
      const body = msg.source.toString().toLowerCase();
      const ts = new Date().toISOString();
      if (body.includes("unsubscribe")) {
        fs.appendFileSync(uPath, `${from},${ts},inbox\n`,"utf8");
      }
      if (body.includes("undeliverable") || body.includes("delivery has failed")) {
        fs.appendFileSync(bPath, `${from},${ts},bounce\n`,"utf8");
      }
      if (body.includes("abuse complaint") || body.includes("spam complaint")) {
        fs.appendFileSync(cPath, `${from},${ts},complaint\n`,"utf8");
      }
    }
    await client.logout();
  } catch(e){
    console.log("[poll_inbox] error reading IMAP", e.message);
  }
}

main().catch(err=>{
  console.error("[poll_inbox] fatal", err);
  process.exit(0);
});
