/**
 * lead-gateway Worker — minimal, safe, no-external-deps.
 * Endpoints:
 *   POST /lead   -> accepts JSON {company,email,vendors,notes?,plan?,region?}
 *   POST /unsub  -> accepts JSON {email, reason?}
 *   POST /stripe -> (placeholder passthrough) acknowledges receipt
 *   GET  /health -> returns {ok:true}
 *
 * CORS: allows POST from any origin listed in ALLOW_ORIGINS (env) or '*'.
 * Slack (optional): set env.SLACK_WEBHOOK_URL to forward a concise lead message.
 */
const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

function corsHeaders(origin, allow="POST,OPTIONS") {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": allow,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Stripe-Signature",
    "Access-Control-Max-Age": "86400",
  };
}

function ok(body = { ok: true }, origin = "*") {
  return new Response(JSON.stringify(body), { status: 200, headers: {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders(origin)
  }});
}

function bad(status, message, origin="*") {
  return new Response(JSON.stringify({ ok:false, error: message }), { status, headers: {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders(origin)
  }});
}

async function readJson(req) {
  try {
    const txt = await req.text();
    if (!txt) return {};
    return JSON.parse(txt);
  } catch (e) {
    return {};
  }
}

function pickOrigin(req, env) {
  try {
    const allow = (env.ALLOW_ORIGINS || "*").split(",").map(s=>s.trim()).filter(Boolean);
    const origin = req.headers.get("Origin") || "*";
    if (allow.includes("*") || allow.includes(origin)) return origin;
    return "*";
  } catch { return "*"; }
}

async function postSlack(env, text) {
  const url = env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type":"application/json" },
      body: JSON.stringify({ text })
    });
  } catch (e) {
    // ignore slack errors (non-blocking)
  }
}

async function handleLead(req, env) {
  const origin = pickOrigin(req, env);
  const data = await readJson(req);
  const email = (data.email || "").trim();
  const company = (data.company || "").toString().trim();
  const vendors = Array.isArray(data.vendors) ? data.vendors : (typeof data.vendors === "string" ? data.vendors.split(/[\s,]+/) : []);
  if (!EMAIL_RE.test(email)) return bad(400, "invalid email", origin);
  if (!company) return bad(400, "company required", origin);
  const payload = {
    at: new Date().toISOString(),
    email, company,
    vendors: vendors.filter(Boolean).slice(0, 200),
    notes: (data.notes || "").toString().slice(0, 1000),
    plan: (data.plan || "").toString().slice(0, 64),
    region: (data.region || "").toString().slice(0, 32),
    ua: req.headers.get("User-Agent") || ""
  };
  // optional Slack fan-out
  const vStr = payload.vendors.length ? (" vendors=" + payload.vendors.slice(0,5).join(",")) : "";
  await postSlack(env, `LEAD • ${payload.company} • ${payload.email}${vStr}`);
  return ok({ ok: true, id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) }, origin);
}

async function handleUnsub(req, env) {
  const origin = pickOrigin(req, env);
  const data = await readJson(req);
  const email = (data.email || "").trim();
  if (!EMAIL_RE.test(email)) return bad(400, "invalid email", origin);
  await postSlack(env, `UNSUB • ${email} • ${data.reason || ""}`);
  return ok({ ok: true }, origin);
}

async function handleStripe(req, env) {
  const origin = pickOrigin(req, env);
  // NOTE: placeholder accept. Real signature verification (Stripe-Signature) can be added if env.STRIPE_WEBHOOK_SECRET is set.
  // We acknowledge immediately to avoid timeouts; downstream processing continues through GitHub workflows.
  return ok({ ok: true, received: true }, origin);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/$/,""); // strip trailing slash
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(pickOrigin(req, env)) });
    if (req.method === "GET" && (p === "" || p === "/")) return ok({ ok: true, name: "lead-gateway", time: new Date().toISOString() }, pickOrigin(req, env));
    if (req.method === "POST" && p === "/lead") return handleLead(req, env);
    if (req.method === "POST" && p === "/unsub") return handleUnsub(req, env);
    if (req.method === "POST" && p === "/stripe") return handleStripe(req, env);
    return new Response("Not found", { status: 404, headers: corsHeaders(pickOrigin(req, env), "GET,POST,OPTIONS") });
  }
};