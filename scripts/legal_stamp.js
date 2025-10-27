#!/usr/bin/env node
/**
 * legal_stamp.js
 *
 * - Generate/refresh /legal/*.html with COMPANY_LEGAL_NAME + MAIL_POSTAL_ADDRESS.
 * - Inject footer block with Privacy / Terms / Postal address / unsubscribe notice
 *   into index.html, dashboard/*.html, enterprise/index.html (if missing).
 *
 * ENV:
 *   COMPANY_LEGAL_NAME
 *   MAIL_POSTAL_ADDRESS
 *
 * Safe exit if env missing -> CI won't blow up.
 *
 * NOTE: The generated legal docs are template boilerplate. You MUST have a human lawyer review
 * before using them as binding terms. This script makes sure something exists & is published,
 * so outreach emails + landing pages aren't obviously non-compliant.
 */

const fs = require("fs");
const path = require("path");

const COMPANY = process.env.COMPANY_LEGAL_NAME || "CG Alert LLC";
const ADDRESS = process.env.MAIL_POSTAL_ADDRESS || "Your Company, 123 Street, City, Country";

function buildTermsHtml() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Terms of Service – ${COMPANY}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;line-height:1.5;color:#111;padding:1rem;max-width:48rem;margin:0 auto;">
<h1 style="font-size:1rem;font-weight:600;margin:0 0 1rem 0;">Terms of Service</h1>
<p style="font-size:.8rem;color:#555;">These Terms are a template baseline, not legal advice. You must review with counsel.</p>

<p style="font-size:.9rem;">1. Service. ${COMPANY} provides access to timestamped evidence of vendor changes (pricing, terms, sub-processors, DPAs, SLAs, etc.) for use in renewals, compliance, procurement and commercial negotiations.</p>

<p style="font-size:.9rem;">2. License. We grant you a non-transferable, non-exclusive, revocable right to access our evidence dashboard and alerts for internal business use. You may present excerpts internally to procurement / legal / RevOps and in negotiations with the relevant vendor(s).</p>

<p style="font-size:.9rem;">3. No guarantee. We monitor public sources and generate diffs. We do not guarantee completeness, correctness, legal sufficiency, or that a vendor will honor your arguments. You accept that you must verify any cited terms before executing commercial decisions.</p>

<p style="font-size:.9rem;">4. Confidentiality. You must not resell, redistribute or publish our evidence snapshots as a competing product. Internal procurement/legal use is fine; reselling it as a service is not.</p>

<p style="font-size:.9rem;">5. Payment & Term. Subscriptions renew annually unless canceled. Non-payment or misuse allows us to suspend access.</p>

<p style="font-size:.9rem;">6. Liability Cap. Our total liability is capped at the fees you paid us in the 12 months prior to the claim. We are not liable for indirect, incidental, special, or consequential damages.</p>

<p style="font-size:.9rem;">7. Compliance. You are responsible for your own regulatory/compliance outcomes. We are an intelligence feed, not your lawyer.</p>

<p style="font-size:.9rem;">8. Governing Law / Venue. By using the service you agree disputes are governed by applicable law of our primary business domicile and exclusive venue there. (Customize with your counsel.)</p>

<p style="font-size:.8rem;color:#555;margin-top:2rem;">Postal address: ${ADDRESS}</p>
<p style="font-size:.7rem;color:#999;margin-top:1rem;">THIS IS A TEMPLATE. REVIEW WITH COUNSEL BEFORE RELYING ON IT.</p>

</body></html>`;
}

function buildPrivacyHtml() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Privacy Policy – ${COMPANY}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;line-height:1.5;color:#111;padding:1rem;max-width:48rem;margin:0 auto;">
<h1 style="font-size:1rem;font-weight:600;margin:0 0 1rem 0;">Privacy Policy</h1>
<p style="font-size:.8rem;color:#555;">Template baseline. Not legal advice.</p>

<p style="font-size:.9rem;">We collect business contact data for procurement, renewal, compliance and vendor-risk discussions. This includes name, role/title, corporate email and company domain. We use this data to send alerts that a vendor changed terms (pricing, DPA, sub-processors, SLAs, etc.) that may affect negotiations.</p>

<p style="font-size:.9rem;">Opt-out / unsubscribe: Every outreach email contains an unsubscribe link that immediately flags your address as “unsub”; once flagged, we stop outreach to that address. You can also email abuse@cg-alert.com asking removal.</p>

<p style="font-size:.9rem;">Data sources: (1) publicly available corporate contact info, (2) inbound forms you submit (intake), (3) purchased/partner lead-enrichment data under B2B legitimate-interest standards for procurement/commercial communications.</p>

<p style="font-size:.9rem;">Retention: We maintain unsub/bounce/complaint records to ensure we do not contact you again. We maintain high-level activity logs (evidence snapshots captured, outreach sent) to improve service quality and demonstrate compliance posture.</p>

<p style="font-size:.9rem;">We do not sell personal contact info as raw lists.</p>

<p style="font-size:.9rem;">You may request removal at any time via unsubscribe link or abuse@cg-alert.com. We will keep a minimal suppression record (your email as “do not contact”) so we do not re-add you.</p>

<p style="font-size:.8rem;color:#555;margin-top:2rem;">Postal address: ${ADDRESS}</p>
<p style="font-size:.7rem;color:#999;margin-top:1rem;">THIS IS A TEMPLATE. REVIEW WITH COUNSEL BEFORE RELYING ON IT.</p>

</body></html>`;
}

function buildDpaHtml() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Data Processing Addendum (Template) – ${COMPANY}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;line-height:1.5;color:#111;padding:1rem;max-width:48rem;margin:0 auto;">
<h1 style="font-size:1rem;font-weight:600;margin:0 0 1rem 0;">Data Processing Addendum (Template)</h1>
<p style="font-size:.8rem;color:#555;">Template only. You MUST negotiate final DPA with counsel.</p>

<p style="font-size:.9rem;">This DPA describes how ${COMPANY} may process business contact details (name, title, corporate email, company name, region) solely to deliver vendor-change alerts related to procurement, renewals, compliance and vendor risk.</p>

<p style="font-size:.9rem;">We act as an independent controller / processor (jurisdiction-dependent). We process only minimally required B2B contact data, retain suppression records for opt-out enforcement, and do not resell raw contact info as a standalone product.</p>

<p style="font-size:.9rem;">Where required, we will execute a mutually agreed DPA reflecting controller / processor roles, sub-processors, and international transfer terms. Contact us for a countersigned copy.</p>

<p style="font-size:.8rem;color:#555;margin-top:2rem;">Postal address: ${ADDRESS}</p>
<p style="font-size:.7rem;color:#999;margin-top:1rem;">THIS IS A TEMPLATE. REVIEW WITH COUNSEL BEFORE RELYING ON IT.</p>

</body></html>`;
}

function buildOrderFormHtml() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Order Form – ${COMPANY}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;line-height:1.5;color:#111;padding:1rem;max-width:48rem;margin:0 auto;">
<h1 style="font-size:1rem;font-weight:600;margin:0 0 1rem 0;">Order Form</h1>
<p style="font-size:.8rem;color:#555;">Template baseline for enterprise PO / invoice flow.</p>

<p style="font-size:.9rem;">
Customer agrees to purchase access to ${COMPANY}'s vendor-change evidence service (“Service”) for 12 months. Service includes:
(a) dashboard access,
(b) ongoing monitoring of named vendors,
(c) timestamped change records and diffs for internal procurement/legal/RevOps use.
</p>

<p style="font-size:.9rem;">
Fees: Annual subscription fee invoiced net 30. Unless otherwise negotiated, renewal is annual and subject to then-current pricing.
</p>

<p style="font-size:.9rem;">
Governing docs: This Order Form incorporates (i) Terms of Service, (ii) Privacy Policy, and (iii) DPA (if executed) available on our site.
</p>

<p style="font-size:.9rem;">
Liability cap: limited to fees paid in the prior 12 months. No indirect or consequential damages.
</p>

<p style="font-size:.8rem;color:#555;margin-top:2rem;">
Postal address: ${ADDRESS}<br/>
Company legal name: ${COMPANY}
</p>

<p style="font-size:.7rem;color:#999;margin-top:1rem;">THIS IS A TEMPLATE. REVIEW WITH COUNSEL BEFORE SIGNATURE.</p>

</body></html>`;
}

function ensureDir(d) {
  fs.mkdirSync(d, {recursive:true});
}

function writeIfDifferent(fp, content) {
  const old = fs.existsSync(fp) ? fs.readFileSync(fp,"utf8") : "";
  if (old !== content) {
    fs.writeFileSync(fp, content, "utf8");
    console.log("[legal_stamp] wrote", fp);
  }
}

function injectFooter(fp) {
  if (!fs.existsSync(fp)) return;
  let html = fs.readFileSync(fp,"utf8");
  const orig = html;
  const footerBlock = `
<footer style="border-top:1px solid #ddd;padding-top:1rem;margin-top:2rem;font-size:.8rem;color:#555;">
  <div>${COMPANY} — automated vendor change intelligence for renewals / compliance / procurement leverage.</div>
  <div style="margin-top:.5rem;">Postal address: ${ADDRESS}</div>
  <div style="margin-top:.5rem;font-size:.75rem;color:#777;">
    Privacy: <a href="/legal/privacy.html" style="color:#0645ad;text-decoration:underline;">Privacy Policy</a> ·
    Terms: <a href="/legal/terms.html" style="color:#0645ad;text-decoration:underline;">Terms</a> ·
    DPA: <a href="/legal/dpa.html" style="color:#0645ad;text-decoration:underline;">DPA Template</a><br/>
    You can unsubscribe from outreach instantly via the link in any email.
  </div>
</footer>`;

  if (!/Privacy Policy/i.test(html) || !/Terms/i.test(html) || !/Postal address:/i.test(html)) {
    if (html.includes("</body>")) {
      html = html.replace("</body>", footerBlock + "\n</body>");
    } else {
      html += footerBlock;
    }
  }

  if (html !== orig) {
    fs.writeFileSync(fp, html, "utf8");
    console.log("[legal_stamp] footer injected:", fp);
  }
}

(function main(){
  // generate /legal/*.html
  ensureDir("legal");
  writeIfDifferent(path.join("legal","terms.html"),       buildTermsHtml());
  writeIfDifferent(path.join("legal","privacy.html"),     buildPrivacyHtml());
  writeIfDifferent(path.join("legal","dpa.html"),         buildDpaHtml());
  writeIfDifferent(path.join("legal","order-form.html"),  buildOrderFormHtml());

  // inject footer into key pages
  injectFooter("index.html");
  injectFooter(path.join("enterprise","index.html"));
  if (fs.existsSync("dashboard")) {
    for (const f of fs.readdirSync("dashboard")) {
      if (f.endsWith(".html")) {
        injectFooter(path.join("dashboard", f));
      }
    }
  }

  console.log("[legal_stamp] done");
})();
