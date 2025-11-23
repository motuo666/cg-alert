// cf/stripe-dispatcher/src/index.js
// Purpose: Verify Stripe webhook signature at the edge and forward a repository_dispatch
//          to GitHub (event_type: "stripe_paid") with minimal customer payload.
// Runtime: Cloudflare Workers (standard Web Crypto; no node libs).

/**
 * Parse Stripe-Signature header into { t, v1[] }
 */
function parseStripeSig(sigHeader) {
  const out = { t: null, v1: [] };
  if (!sigHeader) return out;
  for (const part of sigHeader.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k === 't') out.t = v;
    if (k === 'v1') out.v1.push(v);
  }
  return out;
}

/**
 * Convert ArrayBuffer -> hex
 */
function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  const hex = [];
  for (let b of bytes) hex.push(b.toString(16).padStart(2, '0'));
  return hex.join('');
}

/**
 * HMAC-SHA256(secret, message) -> hex
 */
async function hmacSHA256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toHex(sig);
}

/**
 * Constant-time equals for hex strings
 */
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return res === 0;
}

/**
 * Extract best-effort customer payload from Stripe event
 */
function extractClientPayload(evt) {
  const obj = evt?.data?.object || {};
  const md = obj.metadata || {};
  const lines = obj.lines || {};
  const customer_details = obj.customer_details || {};
  const email = md.email || obj.customer_email || customer_details.email || md.customer_email || null;
  const company = md.company || md.org || null;
  const tier = md.tier || md.plan || (obj?.metadata?.product_name) || null;
  const cadence = md.cadence || 'weekly';
  const vendors = (md.vendors || '').split(',').map(s => s.trim()).filter(Boolean);

  return {
    email, company, tier, cadence, vendors,
    stripe_event_id: evt.id,
    stripe_type: evt.type,
    created: evt.created
  };
}

async function handleStripe(request, env) {
  const body = await request.text();
  const header = request.headers.get('Stripe-Signature') || '';
  const sig = parseStripeSig(header);
  if (!sig.t || sig.v1.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_signature' }), { status: 400 });
  }
  const signedPayload = `${sig.t}.${body}`;
  const expect = await hmacSHA256Hex(env.STRIPE_WEBHOOK_SECRET, signedPayload);
  const anyMatch = sig.v1.some(v => timingSafeEqualHex(v, expect));
  if (!anyMatch) {
    return new Response(JSON.stringify({ ok: false, error: 'bad_signature' }), { status: 400 });
  }

  let evt;
  try {
    evt = JSON.parse(body);
  } catch (_) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), { status: 400 });
  }

  // Only handle successful events
  const supported = new Set(['checkout.session.completed', 'invoice.payment_succeeded']);
  if (!supported.has(evt.type)) {
    return new Response(JSON.stringify({ ok: true, ignored: evt.type }), { status: 200 });
  }

  // Idempotency: ensure each Stripe event is processed at most once.
  // Uses D1 (env.DB) table `stripe_events` with a UNIQUE primary key on `id`.
  if (env.DB && evt.id) {
    try {
      const res = await env.DB
        .prepare('INSERT OR IGNORE INTO stripe_events (id, type, created_at) VALUES (?, ?, strftime("%s","now"))')
        .bind(evt.id, evt.type || null)
        .run();
      const changes = res && res.meta && typeof res.meta.changes === 'number' ? res.meta.changes : 0;
      if (changes === 0) {
        // Already processed: acknowledge to Stripe but skip downstream dispatch.
        return new Response(JSON.stringify({ ok: true, duplicate: true, event: evt.id }), { status: 200 });
      }
    } catch (err) {
      // If D1 is temporarily unavailable we prefer to continue processing
      // rather than risk losing a payment event. Downstream workflows should
      // still be resilient to duplicate dispatches.
    }
  }

  const payload = extractClientPayload(evt);
  const dispatchURL = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/dispatches`;

  const ghRes = await fetch(dispatchURL, {
    method: 'POST',
    headers: {
      'Authorization': `token ${env.GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'cg-alert-stripe-dispatcher'
    },
    body: JSON.stringify({
      event_type: 'stripe_paid',
      client_payload: payload
    })
  });

  const ok = ghRes.ok;
  const txt = await ghRes.text();
  if (!ok) {
    return new Response(JSON.stringify({ ok: false, error: 'github_dispatch_failed', details: txt }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, dispatched: true }), { status: 200 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      // health check
      return new Response(JSON.stringify({ ok: true, name: 'stripe-dispatcher', route: url.pathname }), { status: 200 });
    }
    if (url.pathname.startsWith('/stripe')) {
      if (!env.STRIPE_WEBHOOK_SECRET || !env.GH_OWNER || !env.GH_REPO || !env.GH_TOKEN) {
        return new Response(JSON.stringify({ ok: false, error: 'missing_env' }), { status: 500 });
      }
      return await handleStripe(request, env);
    }
    return new Response('not found', { status: 404 });
  }
};
