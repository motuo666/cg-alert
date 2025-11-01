// Cloudflare Worker — /unsub handler (GET/POST) storing to KV; optional Slack notify
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/unsub') {
      if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method not allowed', {status:405});
      const email = url.searchParams.get('m') || '';
      const token = url.searchParams.get('t') || '';
      if (!email || !token) return new Response('Bad request', {status:400});
      const ok = await verifyHMAC(email, token, env.UNSUB_HMAC_SECRET);
      if (!ok) return new Response('Bad token', {status:403});
      const key = `unsub:${email.toLowerCase()}`;
      const rec = { email, at: new Date().toISOString(), ua: request.headers.get('user-agent')||'', ip: request.headers.get('cf-connecting-ip')||'' };
      await env.KV.put(key, JSON.stringify(rec));
      if (env.SLACK_WEBHOOK_URL) {
        try{ await fetch(env.SLACK_WEBHOOK_URL, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({text:`🔕 Unsubscribed: ${email}`})}); }catch(e){}
      }
      const html = `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title><h1>Unsubscribed</h1><p>${email} will no longer receive outreach from CG Alert.</p>`;
      return new Response(html, { headers: {'content-type':'text/html; charset=utf-8'} });
    }
    return new Response('OK', {status:200});
  }
}
async function verifyHMAC(email, token, secret){
  const alg = { name: "HMAC", hash: "SHA-256" };
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret||''), alg, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(email)));
  const hex = [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,24);
  return hex === token;
}
