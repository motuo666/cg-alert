// Cloudflare Worker: Unsubscribe endpoint
// Bindings: CG_SUPPRESS_KV (KV), UNSUB_HMAC_SECRET (env)
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== '/' && url.pathname !== '/u') {
      return new Response('Not Found', { status: 404 });
    }
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }
    try {
      let email, sig;
      if (req.method === 'POST') {
        const ct = req.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const body = await req.json();
          email = (body.email || '').trim().toLowerCase();
          sig = (body.sig || body.s || '').trim();
        } else {
          const body = await req.text();
          const params = new URLSearchParams(body);
          email = (params.get('email') || '').trim().toLowerCase();
          sig = (params.get('sig') || params.get('s') || '').trim();
        }
      } else {
        email = (url.searchParams.get('u') || url.searchParams.get('email') || '').trim().toLowerCase();
        sig = (url.searchParams.get('s') || url.searchParams.get('sig') || '').trim();
      }
      if (!email || !sig) return html('Invalid unsubscribe link', 400);

      // Verify HMAC
      const ok = await verifyHmac(email, sig, env.UNSUB_HMAC_SECRET || '');
      if (!ok) return html('Signature invalid', 403);

      // Persist suppression
      const key = `unsub:${email}`;
      await env.CG_SUPPRESS_KV.put(key, JSON.stringify({ email, ts: Date.now() }), { expirationTtl: 60*60*24*365*5 });

      return html('You have been unsubscribed from CG Alert emails.');
    } catch (e) {
      return html('Server error', 500);
    }
  }
};

async function verifyHmac(email, sig, secret) {
  if (!secret) return false;
  const enc = new TextEncoder();
  const data = enc.encode(email);
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const raw = await crypto.subtle.sign('HMAC', key, data);
  const hex = Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2,'0')).join('');
  return timingSafeEqual(hex, sig.toLowerCase());
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function html(body, status=200) {
  return new Response(`<!doctype html><meta charset="utf-8"><title>CG Alert</title><body style="font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial">
  <div style="max-width:680px;margin:64px auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
    <h1>CG Alert</h1><p>${body}</p>
  </div></body>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' }});
}
