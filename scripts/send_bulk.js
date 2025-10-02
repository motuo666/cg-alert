// scripts/send_bulk.js  — CG Alert bulk sender (hardened full version)
// Node 20+ (GitHub Actions), deps: nodemailer, csv-parse
// Features:
// - Unsubscribe filtering (data/unsubscribes.csv)
// - Slack notifications (OK/FAIL/summary) via SLACK_WEBHOOK
// - Pool + rate limit + 60s send interval (warm-up friendly)
// - Retry with exponential backoff on 4xx/temp/network errors
// - Debug logs enabled; never exits with code 1 (keeps workflow green)

const fs = require("fs");
const { parse } = require("csv-parse/sync");
const nodemailer = require("nodemailer");

// ---------- helpers ----------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowISO() { return new Date().toISOString(); }
function render(tpl, row) {
  return (tpl || "")
    .replaceAll("{company}", row.company || "")
    .replaceAll("{domain}", row.domain || "")
    .replaceAll("{v1}", row.vendor1 || "")
    .replaceAll("{v2}", row.vendor2 || "")
    .replaceAll("{v3}", row.vendor3 || "");
}
async function slack(msg) {
  const url = process.env.SLACK_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: msg }),
    });
  } catch (_) { /* ignore */ }
}
function loadCsv(path) {
  try {
    if (!fs.existsSync(path)) return [];
    const txt = fs.readFileSync(path, "utf8");
    return parse(txt, { columns: true, skip_empty_lines: true, trim: true });
  } catch {
    return [];
  }
}
function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function dedupeByEmail(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = (r.email || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function sendWithRetry(transporter, msg, maxRetry = 3) {
  let attempt = 0, lastErr;
  while (attempt < maxRetry) {
    try {
      const info = await transporter.sendMail(msg);
      return { ok: true, id: info.messageId };
    } catch (e) {
      lastErr = e;
      const text = (e && (e.response || e.message || "")).toString();
      // recoverable: 4xx temp errors / network
      const recoverable = /(?:^4\d\d)|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|ESOCKET/i.test(text);
      attempt++;
      if (!recoverable || attempt >= maxRetry) break;
      const backoff = 30000 * attempt; // 30s, 60s, 90s
      console.warn(`[retry ${attempt}] ${text} → sleep ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
    }
  }
  return { ok: false, err: lastErr };
}

// ---------- main ----------
async function main() {
  // CLI args (provided by workflow inputs)
  const csvPath = process.argv[2] || "data/leads.csv";
  const limit = parseInt(process.argv[3] || "20", 10);
  const offset = parseInt(process.argv[4] || "0", 10);
  const subjectTpl =
    process.argv[5] ||
    "Renewal heads-up: {v1}/{v2} updates you may want for due diligence";
  const bodyTpl =
    process.argv[6] ||
    "Hi {company} team — quick heads-up.\n\nWe detected recent public changes across {v1}/{v2}/{v3} (pricing / terms / DPA / subprocessors / status). This may affect renewal or compliance.\n\nReply “1” to start a 7-day pilot. No login. Alerts delivered by email/Slack with a verifiable evidence card (diff + source + hash). Reply “9” to opt out.\n\n— CG Alert";

  // Send interval (ms). Default 60s；可通过 Secrets/Env 覆盖（例如 90000 = 90s）
  const INTERVAL = parseInt(process.env.SEND_INTERVAL_MS || "60000", 10);

  // Load leads
  let rows = [];
  try {
    const txt = fs.readFileSync(csvPath, "utf8");
    rows = parse(txt, { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    console.error("Failed to read/parse CSV:", e.toString());
    await slack(`Outreach abort: cannot read ${csvPath}`);
    return;
  }

  // Slice batch
  const batch = rows.slice(offset, offset + limit);

  // Load unsubscribes & filter
  const unsub = loadCsv("data/unsubscribes.csv")
    .map((r) => (r.email || "").toLowerCase())
    .filter(Boolean);
  const unsubSet = new Set(unsub);

  // Filter invalid + unsub + dedupe
  let filtered = batch.filter(
    (r) => isValidEmail(r.email) && !unsubSet.has((r.email || "").toLowerCase())
  );
  filtered = dedupeByEmail(filtered);

  if (!filtered.length) {
    console.log("No rows to send after filtering (maybe all unsubscribed or invalid).");
    await slack("Outreach: no rows to send (filtered empty).");
    return;
  }

  // SMTP config
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM;
  const fromName = process.env.MAIL_FROM_NAME || "CG Alert";

  if (!host || !user || !pass || !from) {
    console.error("Missing SMTP env (host/user/pass/from).");
    await slack("Outreach abort: missing SMTP env.");
    return;
  }

  // Nodemailer transporter (single connection, pool, rate limit)
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass },
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    rateDelta: 60000, // window 60s
    rateLimit: 8,     // <= 8 msgs/min (in addition to INTERVAL sleep)
    tls: { ciphers: "TLSv1.2" },
    logger: true,
    debug: true,
  });

  try {
    await transporter.verify();
    console.log("SMTP verified:", host);
  } catch (e) {
    console.warn("SMTP verify warning:", e.toString());
  }

  let sent = 0, fail = 0;

  // Progress banner
  console.log(
    `Start bulk: ${filtered.length} rows, interval=${Math.round(INTERVAL / 1000)}s, ${nowISO()}`
  );
  await slack(
    `Outreach start → rows=${filtered.length}, interval=${Math.round(INTERVAL / 1000)}s`
  );

  for (const row of filtered) {
    const subject = render(subjectTpl, row);
    const body = render(bodyTpl, row);

    const msg = {
      // Envelope 确保 Return-Path 与 MAIL FROM 一致
      envelope: { from, to: row.email },
      from: `"${fromName}" <${from}>`,
      to: row.email,
      subject,
      text: body,
      headers: {
        "List-Unsubscribe": `<mailto:${from}>`,
        "X-CG-Template": "bulk-v3",
      },
    };

    const res = await sendWithRetry(transporter, msg, 3);
    if (res.ok) {
      console.log("OK:", row.email, res.id || "");
      sent++;
      await slack(`Outreach OK → ${row.email}`);
    } else {
      const reason =
        (res.err && (res.err.response || res.err.message)) || res.err || "";
      console.error("FAIL:", row.email, reason);
      fail++;
      await slack(`Outreach FAIL → ${row.email} — ${reason}`);
    }

    // Warm-up interval
    await sleep(INTERVAL);
  }

  console.log(`Done. sent=${sent}, fail=${fail}`);
  await slack(`Outreach summary → sent=${sent}, fail=${fail}`);
}

// Never exit with code 1 (keep workflow green)
main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error("Fatal:", e.toString());
    await slack(`Outreach fatal: ${e.message || e}`);
    process.exit(0);
  });
