/**
 * lead-gateway Worker (patch 2025-10-21)
 * Routes:
 *  - POST /lead     : accept CTA/form payload, enrich UTM/referrer, set cg_lead_id cookie, upsert KV lead:{email}
 *  - GET  /u        : unsubscribe endpoint with HMAC token (?e=<email>&t=<token>)
 *  - POST /stripe   : Stripe webhook (checkout.session.completed) -> attach plan/amount/period to lead
 *
 * Bindings expected (configure in Cloudflare dashboard -> Worker -> Settings):
 *  - KV namespace binding: LEADS  (points to your existing KV namespace)
 *  - Vars: UNSUB_HMAC_SECRET, STRIPE_WEBHOOK_SECRET, SITE_ORIGIN (optional), SLACK_WEBHOOK_URL (optional)
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS (allow simple POST from Pages)
    if (request.method === "OPTIONS") {
      return corsResponse();
    }

    try {
      if (pathname === "/lead" && request.method === "POST") {
        return await handleLead(request, env);
      }
      if (pathname === "/u" && request.method === "GET") {
        return await handleUnsub(request, env);
      }
      if (pathname === "/stripe" && request.method === "POST") {
        return await handleStripe(request, env);
      }
      return new Response(JSON.stringify({ ok: true, ping: "lead-gateway" }), {
        headers: jsonHeaders(),
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err?.stack || err) }), {
        status: 500,
        headers: jsonHeaders(),
      });
    }
  },
};

function jsonHeaders() {
  return {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

async function handleLead(request, env) {
  const url = new URL(request.url);
  const contentType = request.headers.get("content-type") || "";
  let body = {};
  if (contentType.includes("application/json")) {
    body = await request.json();
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    form.forEach((v, k) => (body[k] = v));
  }

  // basic validation
  const email = String((body.email || body.Email || body.e || "").toLowerCase().trim());
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid_email" }), { status: 400, headers: jsonHeaders() });
  }

  // cookie for lead id
  const cookieIn = request.headers.get("cookie") || "";
  const cookies = Object.fromEntries(cookieIn.split(";").map(s => s.trim().split("=").map(decodeURIComponent)).filter(x => x[0]));
  let lid = cookies["cg_lead_id"] || body["cg_lead_id"] || crypto.randomUUID();

  // UTM/referrer enrichment
  const utm = {
    utm_source: body.utm_source || url.searchParams.get("utm_source") || "",
    utm_medium: body.utm_medium || url.searchParams.get("utm_medium") || "",
    utm_campaign: body.utm_campaign || url.searchParams.get("utm_campaign") || "",
    utm_content: body.utm_content || url.searchParams.get("utm_content") || "",
    utm_term: body.utm_term || url.searchParams.get("utm_term") || "",
  };
  const now = new Date().toISOString();
  const referrer = body.referrer || request.headers.get("referer") || "";
  const landing_url = body.landing_url || (referrer ? referrer : (env.SITE_ORIGIN ? `${env.SITE_ORIGIN}/` : ""));
  const ua = request.headers.get("user-agent") || "";
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";

  const key = `lead:${email}`;
  let existing = await env.LEADS.get(key, { type: "json" });
  if (!existing) {
    existing = {
      email,
      lid,
      status: "new",
      unsub: false,
      bounced: false,
      first_touch: { ...utm, referrer, landing_url, ts: now },
      last_touch: { ...utm, referrer, landing_url, ts: now },
      ua_first: ua,
      ip_hash: await sha256Hex(ip),
      touches: [],
      drip: { sent: [] },
      created_at: now,
      updated_at: now,
    };
  } else {
    // keep first_touch; update last_touch
    existing.last_touch = { ...utm, referrer, landing_url, ts: now };
    existing.updated_at = now;
  }

  existing.touches.push({ ts: now, ...utm, referrer, landing_url });
  await env.LEADS.put(key, JSON.stringify(existing), { expirationTtl: 60 * 60 * 24 * 365 * 3 }); // 3y TTL

  // set cookie
  const res = new Response(JSON.stringify({ ok: true, lid, email }), { headers: jsonHeaders() });
  res.headers.set("set-cookie", `cg_lead_id=${encodeURIComponent(lid)}; Path=/; HttpOnly; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`);
  return res;
}

async function handleUnsub(request, env) {
  const url = new URL(request.url);
  const e = url.searchParams.get("e") || "";
  const t = url.searchParams.get("t") || "";
  if (!e || !t) return new Response("Missing params", { status: 400 });

  const ok = await hmacVerify(env.UNSUB_HMAC_SECRET, e.toLowerCase(), t);
  if (!ok) return new Response("Invalid token", { status: 403 });

  const key = `lead:${e.toLowerCase()}`;
  let lead = await env.LEADS.get(key, { type: "json" });
  if (!lead) return new Response("OK (no record)", { status: 200 });

  lead.unsub = true;
  lead.status = "unsub";
  lead.updated_at = new Date().toISOString();
  await env.LEADS.put(key, JSON.stringify(lead), { expirationTtl: 60 * 60 * 24 * 365 * 3 });
  return new Response("You have been unsubscribed. ✔", { headers: { "content-type": "text/plain; charset=utf-8" } });
}

async function handleStripe(request, env) {
  const raw = await request.text();
  const sig = request.headers.get("stripe-signature") || "";
  if (!sig) return new Response("Missing signature", { status: 400 });

  // Verify Stripe signature (v1 with timestamp)
  const parts = Object.fromEntries(sig.split(",").map(s => s.split("=", 2)));
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return new Response("Bad signature header", { status: 400 });
  const signedPayload = `${t}.${raw}`;
  const digest = await hmacHex(env.STRIPE_WEBHOOK_SECRET, signedPayload);
  if (!timingSafeEqualHex(v1, digest)) {
    return new Response("Signature mismatch", { status: 400 });
  }

  const event = JSON.parse(raw || "{}");
  if (event.type === "checkout.session.completed") {
    const session = event.data.object || {};
    const email = String((session.customer_details?.email || "").toLowerCase());
    if (email) {
      const key = `lead:${email}`;
      let lead = await env.LEADS.get(key, { type: "json" }) || { email, touches: [], drip: { sent: [] } };
      lead.status = "verified";
      lead.purchase = {
        id: session.id,
        plan: session.metadata?.plan || session.display_items?.[0]?.plan?.nickname || "unknown",
        amount: session.amount_total || session.amount_subtotal || 0,
        currency: session.currency || "usd",
        period_start: (session.subscription ? undefined : new Date().toISOString()),
        period_end: undefined,
        ts: new Date().toISOString(),
      };
      lead.updated_at = new Date().toISOString();
      await env.LEADS.put(key, JSON.stringify(lead), { expirationTtl: 60 * 60 * 24 * 365 * 3 });

      if (env.SLACK_WEBHOOK_URL) {
        const msg = {
          text: `💸 Stripe checkout completed: ${email} — ${lead.purchase.plan} ${(lead.purchase.amount/100).toFixed(2)} ${lead.purchase.currency.toUpperCase()}`,
        };
        await fetch(env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) });
      }
    }
  }
  return new Response("ok", { status: 200 });
}

// helpers
async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s || ""));
  return hex(new Uint8Array(d));
}
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return hex(new Uint8Array(sig));
}
async function hmacVerify(secret, email, tokenHex) {
  const expected = await hmacHex(secret, email);
  return timingSafeEqualHex(expected, tokenHex);
}
function hex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}
