// scripts/send_autoreply_newlead.js
// Node 18+
// Needs Secrets in GitHub Actions: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, SITE_ORIGIN
// Assumes intake-sync already wrote new leads to leads/new/*.json with { email, source, ts }

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const LEADS_DIR = path.join(__dirname, '..', 'leads', 'new');
const SENT_LOG  = path.join(__dirname, '..', 'leads', 'autoresponded.csv');

function loadSent() {
  if (!fs.existsSync(SENT_LOG)) return new Set();
  const lines = fs.readFileSync(SENT_LOG, 'utf8').split(/\r?\n/).filter(Boolean);
  return new Set(lines.map(l => l.trim().toLowerCase()));
}

function saveSent(set) {
  fs.writeFileSync(SENT_LOG, Array.from(set).join('\n') + '\n', 'utf8');
}

async function main() {
  const sentSet = loadSent();

  const files = fs.existsSync(LEADS_DIR) ? fs.readdirSync(LEADS_DIR) : [];
  if (!files.length) return;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(LEADS_DIR, f);
    let lead;
    try {
      lead = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      continue;
    }
    const email = (lead.email || lead.work_email || '').toLowerCase().trim();
    if (!email || sentSet.has(email)) continue;

    const origin = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
    const subject = `Your Vendor Change Packet (CG Alert demo)`;
    const bodyText = [
      `Here is your Vendor Change Packet preview (redacted):`,
      ``,
      `1. Evidence Dashboard (live demo): ${origin}/dashboard/`,
      `2. Instant self-serve tiers:`,
      `   - Portfolio ($2,988/yr): ${origin}/buy/portfolio`,
      `   - Renewal Desk ($6,000/yr): ${origin}/buy/renewal-desk`,
      `   - Compliance & Vendor Risk ($12,000/yr): ${origin}/buy/compliance`,
      ``,
      `Enterprise / Deal Desk (starts $30k/yr):`,
      `We'll sit in renewal calls w/ Procurement / Legal / Compliance / CFO and hand them timestamped vendor-change receipts.`,
      `Request access: ${origin}/intake`,
      ``,
      `Unsubscribe or never contact again? Reply STOP. We'll permanently suppress you.`
    ].join('\n');

    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject,
      text: bodyText
    });

    sentSet.add(email);
  }

  saveSent(sentSet);
}

main().catch(err => {
  console.error('send_autoreply_newlead failed:', err);
  process.exit(1);
});
