#!/usr/bin/env node
/**
 * repair_pages.js
 *
 * Ensure index.html / enterprise/index.html / dashboard/*.html
 * contain CTA block with /buy/portfolio and /intake.
 * Ensure _redirects has /buy/portfolio and /intake lines.
 * This script is idempotent.
 */

const fs = require("fs");
const path = require("path");

const CTA_BLOCK = `
<div style="margin-top:2rem;padding:1rem;border:1px solid #ddd;border-radius:6px;background:#f9f9f9;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;">
  <div style="font-size:.9rem;line-height:1.4;color:#111;font-weight:600;margin-bottom:.5rem;">Ready to lock pricing/compliance leverage?</div>
  <div style="display:flex;flex-wrap:wrap;gap:.5rem;">
    <a href="/buy/portfolio" style="display:inline-block;background:#111;color:#fff;padding:.5rem .75rem;border-radius:4px;font-size:.8rem;text-decoration:none;">Buy Portfolio · $2,988/yr</a>
    <a href="/intake" style="display:inline-block;background:#0a7cff;color:#fff;padding:.5rem .75rem;border-radius:4px;font-size:.8rem;text-decoration:none;">Request Enterprise</a>
  </div>
</div>
`;

function ensureCtaInFile(fp){
  if (!fs.existsSync(fp)) return;
  let html = fs.readFileSync(fp,"utf8");
  if (!/\/buy\/portfolio/.test(html) || !/\/intake/.test(html)) {
    if (html.includes("</body>")) {
      html = html.replace("</body>", CTA_BLOCK+"\n</body>");
    } else {
      html += CTA_BLOCK;
    }
    fs.writeFileSync(fp, html, "utf8");
    console.log("[repair_pages] injected CTA into", fp);
  }
}

function ensureRedirects(){
  const fp = "_redirects";
  let body = fs.existsSync(fp) ? fs.readFileSync(fp,"utf8").trim().split(/\r?\n/) : [];
  let hasBuy = body.some(l=>l.startsWith("/buy/portfolio"));
  let hasIntake = body.some(l=>l.startsWith("/intake"));
  if (!hasBuy) body.push("/buy/portfolio  https://buy.stripe.com/REPLACE_WITH_STRIPE_PORTFOLIO 302");
  if (!hasIntake) body.push("/intake  https://forms.gle/REPLACE_WITH_GOOGLE_FORM 302");
  fs.writeFileSync(fp, body.join("\n")+"\n","utf8");
  console.log("[repair_pages] ensured _redirects entries");
}

(function main(){
  ensureCtaInFile("index.html");
  ensureCtaInFile(path.join("enterprise","index.html"));

  if (fs.existsSync("dashboard")) {
    for (const f of fs.readdirSync("dashboard")) {
      if (f.endsWith(".html")) {
        ensureCtaInFile(path.join("dashboard",f));
      }
    }
  }

  ensureRedirects();
})();
