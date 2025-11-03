// cf/worker-unsub.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const u = url.searchParams.get('u') || '';
    const s = url.searchParams.get('s') || '';
    if (!u || !s) return new Response('Missing parameters', { status: 400 });
    const sig = await hmac(env.UNSUB_HMAC_SECRET, u);
    if (sig !== s) return new Response('Invalid signature', { status: 403 });
    await env.CG_SUPPRESS_KV.put(`unsub:${u}`, new Date().toISOString());
    const html = `<!doctype html><meta charset="utf-8"><title>CG Alert — Unsubscribed</title>
    <style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Helvetica,Arial,sans-serif;color:#0b1533;max-width:720px;margin:10vh auto;padding:0 16px}</style>
    <h1>Unsubscribed</h1><p>You have been removed from future outreach. If this was a mistake, reply to the email to re‑subscribe.</p>`;
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  }
};

async function hmac(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
