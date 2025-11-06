// Cloudflare Worker: Stripe webhook → GitHub repository_dispatch
// ENV: STRIPE_WEBHOOK_SECRET (optional), GH_OWNER, GH_REPO, GH_TOKEN
// Note: configure endpoint at /stripe
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== '/stripe') return new Response('Not Found', { status: 404 });
    const raw = await req.text();
    const sig = req.headers.get('stripe-signature') || '';
    if (env.STRIPE_WEBHOOK_SECRET) {
      const ok = await verifyStripeSig(raw, sig, env.STRIPE_WEBHOOK_SECRET);
      if (!ok) return new Response('Bad signature', { status: 400 });
    }
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }
    // Only care payment_link.paid
    if (event.type !== 'payment_link.paid') {
      return new Response('ok', { status: 200 });
    }
    const payload = {
      event: 'stripe_paid',
      client_payload: {
        type: event.type,
        id: event.id,
        data: event.data && event.data.object ? sanitize(event.data.object) : {}
      }
    };
    const res = await fetch(`https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/dispatches`,{
      method: 'POST',
      headers: {
        'authorization': `token ${env.GH_TOKEN}`,
        'content-type': 'application/json',
        'accept': 'application/vnd.github+json'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const t = await res.text();
      return new Response('GitHub dispatch failed: '+t, { status: 502 });
    }
    return new Response('ok', { status: 200 });
  }
};

function sanitize(o) {
  // drop noisy fields
  const { customer_details, ...rest } = o || {};
  return rest;
}

async function verifyStripeSig(raw, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map(s => s.split('=',2)));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const data = enc.encode(`${t}.${raw}`);
  const mac = await crypto.subtle.sign('HMAC', key, data);
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2,'0')).join('');
  return timingSafeEqual(hex, v1.toLowerCase());
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
