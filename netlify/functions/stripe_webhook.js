// netlify/functions/stripe_webhook.js
//
// ENV VARS you must set in Netlify:
//   STRIPE_SECRET_KEY
//   SENDGRID_API_KEY
//
// Webhook endpoint config in Stripe:
//   URL: https://YOUR_DOMAIN/.netlify/functions/stripe_webhook
//   Events: checkout.session.completed, invoice.payment_succeeded
//
// Behavior:
//   - extracts buyer email
//   - sends them "Your CG Alert access" email with links to evidence/dashboard
//
// NOTE: For production you SHOULD verify Stripe signature.
// This MVP assumes JSON body trusted by your own Stripe webhook setup.

const sgMail = require('@sendgrid/mail');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    console.error("Bad JSON from Stripe webhook", e);
    return { statusCode: 400, body: "Bad JSON" };
  }

  const type = payload.type || "";
  let buyerEmail = "";

  if (type === "checkout.session.completed") {
    buyerEmail = (
      payload.data &&
      payload.data.object &&
      (payload.data.object.customer_details &&
       payload.data.object.customer_details.email)
    ) || "";
  } else if (type === "invoice.payment_succeeded") {
    buyerEmail = (
      payload.data &&
      payload.data.object &&
      (payload.data.object.customer_email ||
       (payload.data.object.customer_details &&
        payload.data.object.customer_details.email))
    ) || "";
  }

  if (!buyerEmail) {
    console.log("No buyerEmail found in webhook type", type);
    return { statusCode: 200, body: "NO_EMAIL" };
  }

  const fulfillmentText = `
Your CG Alert leverage pack is active.

You now have access to timestamped vendor change evidence and renewal leverage language:
- Dashboard: https://www.cg-alert.com/dashboard/
- Example evidence packets:
    https://www.cg-alert.com/public/evidence/vendor-crm/2025-10-26/index.html
    https://www.cg-alert.com/public/evidence/vendor-ai/2025-10-24/index.html
    https://www.cg-alert.com/public/evidence/vendor-email/2025-10-28/index.html

How to use it:
Paste the provided escalation language back to your vendor:
"On the captured date you changed liability caps / SLAs / pricing.
We need credits, legacy terms, or to keep prior liability language."

If you need us to start monitoring vendors (within your tier limit),
reply with the vendor names + renewal deadlines.

If you need more than 6 vendors monitored, reply with how many
(eg. "10 vendors") and we'll quote volume pricing. Fully async. No calls.

– CG Alert
ops@cg-alert.com
`;

  try {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const msg = {
      to: buyerEmail,
      from: {
        email: 'ops@cg-alert.com',
        name: 'CG Alert'
      },
      subject: 'Your CG Alert access',
      text: fulfillmentText
    };
    await sgMail.send(msg);
  } catch (err) {
    console.error("SENDGRID SEND ERROR", err);
  }

  return { statusCode: 200, body: "OK" };
};
