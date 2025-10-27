#!/usr/bin/env node
/**
 * pricing_sync.js
 *
 * Syncs pricing/CTA text and redirect targets across the site.
 *
 * Inputs:
 *   pricing/config.json
 *   env.STRIPE_LINK_PORTFOLIO
 *   env.INTAKE_FORM_URL
 *
 * Updates:
 *   index.html
 *   dashboard/*.html
 *   enterprise/index.html
 *   _redirects
 */

const fs = require("fs");
const path = require("path");

const STRIPE = process.env.STRIPE_LINK_PORTFOLIO || "https://buy.stripe.com/REPLACE_WITH_STRIPE_PORTFOLIO";
const INTAKE = process.env.INTAKE_FORM_URL || "https://forms.gle/REPLACE_WITH_GOOGLE_FORM";

function loadPricing() {
  const raw = fs.readFileSync(path.join("pricing","config.json"), "utf8");
  return JSON.parse(raw);
}

function replaceCta(html, label) {
  // Replace any 'Buy Portfolio · $.../yr' text with new label
  return html
    .replace(/Buy Portfolio · \$[0-9,]+\/yr/g, label)
    .replace(/Buy Portfolio\s*·\s*\$[0-9,]+\/yr/g, label);
}

function ensureCtas(html, label) {
  // If somehow missing CTA block, inject minimal CTA
  if (!html.includes("/buy/portfolio") || !html.includes("/intake")) {
    const block = `
<div style="margin-top:2rem;padding:1rem;border:1px solid #ddd;border-radius:6px;background:#f9f9f9;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;">
  <div style="font-size:.9rem;line-height:1.4;color:#111;font-weight:600;margin-bottom:.5rem;">Ready to lock pricing/compliance leverage?</div>
  <div style="display:flex;flex-wrap:wrap;gap:.5rem;">
    <a href="/buy/portfolio" style="display:inline-block;background:#111;color:#fff;padding:.5rem .75rem;border-radius:4px;font-size:.8rem;text-decoration:none;">${label}</a>
    <a href="/intake" style="display:inline-block;background:#0a7cff;color:#fff;padding:.5rem .75rem;border-radius:4px;font-size:.8rem;text-decoration:none;">Request Enterprise</a>
  </div>
</div>`;
    if (html.includes("</body>")) {
      return html.replace("</body>", block + "\n</body>");
    } else {
      return html + block;
    }
  }
  return html;
}

function syncFile(fp, label) {
  if (!fs.existsSync(fp)) return;
  let html = fs.readFileSync(fp, "utf8");
  const orig = html;
  html = replaceCta(html, label);
  html = ensureCtas(html, label);
  if (html !== orig) {
    fs.writeFileSync(fp, html, "utf8");
    console.log("[pricing_sync] updated", fp);
  }
}

function syncRedirects(fp, stripeUrl, intakeUrl) {
  let body = "";
  if (fs.existsSync(fp)) {
    body = fs.readFileSync(fp,"utf8");
  }
  const lines = body.split(/\r?\n/).filter(Boolean);
  const newLines = lines.filter(l=>!l.startsWith("/buy/portfolio") && !l.startsWith("/intake"));
  newLines.push(`/buy/portfolio  ${stripeUrl} 302`);
  newLines.push(`/intake  ${intakeUrl} 302`);
  const out = newLines.join("\n")+"\n";
  if (out !== body && out.trim() !== "") {
    fs.writeFileSync(fp,out,"utf8");
    console.log("[pricing_sync] updated _redirects");
  }
}

(function main(){
  const pricing = loadPricing();
  const label = pricing.portfolio_sku_label || `Buy Portfolio · $${pricing.portfolio_price_usd_year}/yr`;

  // sync main pages
  syncFile("index.html", label);
  syncFile(path.join("enterprise","index.html"), label);

  // sync dashboard pages
  if (fs.existsSync("dashboard")) {
    for (const f of fs.readdirSync("dashboard")) {
      if (f.endsWith(".html")) {
        syncFile(path.join("dashboard", f), label);
      }
    }
  }

  // sync redirects -> Stripe + Intake
  syncRedirects("_redirects", STRIPE, INTAKE);

  console.log("[pricing_sync] done");
})();
