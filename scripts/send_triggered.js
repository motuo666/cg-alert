// Simplified outreach email body generator aligned with 3-SKU pricing.
// Reads STRIPE_LINK_RENEWAL_DESK / STRIPE_LINK_PORTFOLIO / STRIPE_LINK_COMPLIANCE.

const REN = process.env.STRIPE_LINK_RENEWAL_DESK || '#';
const POR = process.env.STRIPE_LINK_PORTFOLIO || '#';
const COM = process.env.STRIPE_LINK_COMPLIANCE || '#';

function buildEmailBody(company, vendorHints) {
  return `Hi ${company ? company : 'there'},

We ship evidence-backed change alerts you can paste directly into renewal emails.

• Renewal Desk — prebuilt evidence & escalation language (timestamped pricing/SLA/liability/DPA/subprocessor changes). ${REN}
• Portfolio — we continuously monitor up to 3 named vendors you specify and include copy‑pastable leverage language. ${POR}
• Compliance & Vendor Risk — track DPA/subprocessors/liability changes for risk & compliance teams. ${COM}

Fully async. No calls.

If you want us to watch specific vendors${vendorHints ? ' (e.g., ' + vendorHints + ')' : ''}, reply with the names and we'll set it up.
— CG Alert`;
}

module.exports = { buildEmailBody };
