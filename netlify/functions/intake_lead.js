// netlify/functions/intake_lead.js
//
// ENV VARS you must set in Netlify (or your functions host):
//   AIRTABLE_API_KEY
//   AIRTABLE_BASE_ID
//   AIRTABLE_TABLE_NAME
//   SENDGRID_API_KEY
//
// This stores inbound custom / high-volume monitoring requests and auto-replies.
//
// Airtable table fields expected:
//   WorkEmail (text)
//   Company (text)
//   Vendors (long text)
//   RenewalWindow (text)
//   Focus (text)
//   BudgetTier (text)
//   Status (text)

const Airtable = require('airtable');
const sgMail = require('@sendgrid/mail');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // parse x-www-form-urlencoded form body
  const bodyStr = event.body || '';
  const params = {};
  bodyStr.split('&').forEach(kv => {
    const [rawK, rawV] = kv.split('=');
    if (!rawK) return;
    const k = decodeURIComponent(rawK.replace(/\+/g, ' '));
    const v = decodeURIComponent((rawV || '').replace(/\+/g, ' '));
    params[k] = v;
  });

  const workEmail     = params['work_email']      || '';
  const company       = params['company']         || '';
  const vendors       = params['vendors']         || '';
  const renewalWindow = params['renewal_window']  || '';
  const focus         = params['focus']           || '';
  const budget        = params['budget']          || '';

  // 1. store in Airtable
  try {
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
      .base(process.env.AIRTABLE_BASE_ID);

    await base(process.env.AIRTABLE_TABLE_NAME).create([
      {
        fields: {
          WorkEmail: workEmail,
          Company: company,
          Vendors: vendors,
          RenewalWindow: renewalWindow,
          Focus: focus,
          BudgetTier: budget,
          Status: "NEW_INTAKE"
        }
      }
    ]);
  } catch (err) {
    console.error("AIRTABLE ERROR", err);
  }

  // 2. auto-reply to prospect
  // Explain model: 0 / 3 / 6 vendors are swipe-card tiers, >6 vendors is custom quote
  try {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const msg = {
      to: workEmail,
      from: {
        email: 'ops@cg-alert.com',
        name: 'CG Alert'
      },
      subject: 'CG Alert request received',
      text:
`We received your request.

How this works (fully async, no calls):

• Renewal Desk (0 custom vendors):
  Prebuilt vendor change evidence + renewal leverage language for common SaaS.
  Timestamped captures of pricing / SLA / liability / DPA / subprocessor changes.
  You paste our escalation language back to the vendor to demand credits / legacy terms.

• Portfolio (up to 3 vendors monitored):
  We monitor and timestamp contract / pricing / SLA / liability changes
  for up to 3 named vendors you specify.
  We send you escalation language you can paste directly into email.

• Compliance & Vendor Risk (up to 6 vendors monitored):
  We also track subprocessor / DPA / liability shifts, SLA credit downgrades, pricing surprises,
  and produce audit-ready risk summaries you can hand to Legal / Security / TPRM.

• Need more than 6 vendors monitored (>6, e.g. 10 vendors)?
  We'll quote a volume price (example ~20k/yr fully async).
  Still no calls. We deliver by email.

Next step:
We'll email you either:
(1) the correct Stripe checkout link for your tier, or
(2) a custom quote if you asked for >6 vendors.

Once paid, you'll immediately get:
- dashboard links
- timestamped clause changes
- escalation language to paste into vendor emails
- (if in-scope) compliance/risk summaries

No calls. All by email.

– CG Alert (ops@cg-alert.com)
`
    };
    await sgMail.send(msg);
  } catch (err) {
    console.error("SENDGRID ERROR", err);
  }

  // 3. respond to browser
  return {
    statusCode: 200,
    body: "OK"
  };
};
