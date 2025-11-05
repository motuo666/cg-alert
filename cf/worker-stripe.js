/**
 * Cloudflare Worker: STRICT Stripe Webhook -> GitHub repository_dispatch
 * ONLY accepts `payment_link.paid` and maps by Payment Link ID (plink_xxx).
 * Env:
 *  - STRIPE_WEBHOOK_SECRET (whsec_...)
 *  - GH_OWNER / GH_REPO / GH_TOKEN
 *  - STRIPE_PLINK_PORTFOLIO / STRIPE_PLINK_BUSINESS (Payment Link IDs, NOT URLs)
 *  - DEFAULT_CADENCE (optional, fallback: portfolio->weekly, business->daily)
 *  - SLACK_WEBHOOK_URL (optional, ops channel for unknown link alert)
 */
export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("ok",{status:200});
    const body = await request.text();
    let evt; try { evt = JSON.parse(body); } catch { return new Response("bad-json",{status:400}); }
    if ((evt.type||"") !== "payment_link.paid") return new Response("ignored",{status:200});

    const obj = evt.data?.object || {};
    const plink = obj.payment_link || "";
    const email = obj.customer_details?.email || obj.customer_email || "";
    const company = obj.customer_details?.name || obj.metadata?.company || "";

    let plan="", cadence="";
    if (plink === env.STRIPE_PLINK_PORTFOLIO) { plan="portfolio"; cadence="weekly"; }
    else if (plink === env.STRIPE_PLINK_BUSINESS) { plan="business"; cadence="daily"; }
    else {
      if (env.SLACK_WEBHOOK_URL) {
        await fetch(env.SLACK_WEBHOOK_URL, {
          method:"POST", headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ text: `⚠️ Stripe unknown payment_link: ${plink || "N/A"} email=${email||"N/A"}` })
        });
      }
      return new Response("unknown-plink",{status:200});
    }

    if (!email) return new Response("no-email",{status:200});
    const payload = {
      event_type: "stripe_webhook_intake",
      client_payload: { email, company, plan, cadence, vendors: "" }
    };
    const r = await fetch(`https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/dispatches`, {
      method:"POST",
      headers:{ "Authorization": `Bearer ${env.GH_TOKEN}`, "Accept":"application/vnd.github+json" },
      body: JSON.stringify(payload)
    });
    if (!r.ok) return new Response("gh-fail",{status:500});
    return new Response("ok",{status:200});
  }
}
