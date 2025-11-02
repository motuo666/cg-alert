// lead-gateway/src/index.js — extended: /unsub + /stripe webhook
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/unsub') return handleUnsub(request, env);
    if (url.pathname === '/stripe') return handleStripe(request, env);
    return new Response('OK', {status:200});
  }
}

async function handleUnsub(request, env){
  if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method not allowed', {status:405});
  const u = new URL(request.url);
  const email = u.searchParams.get('m') || '';
  const token = u.searchParams.get('t') || '';
  if (!email || !token) return new Response('Bad request', {status:400});
  if (!(await verifyHMAC(email, token, env.UNSUB_HMAC_SECRET))) return new Response('Bad token', {status:403});
  const key = `unsub:${email.toLowerCase()}`;
  const rec = { email, at: new Date().toISOString(), ua: request.headers.get('user-agent')||'', ip: request.headers.get('cf-connecting-ip')||'' };
  await env.KV.put(key, JSON.stringify(rec));
  try{ if (env.SLACK_WEBHOOK_URL) await fetch(env.SLACK_WEBHOOK_URL, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({text:`🔕 Unsubscribed: ${email}`})}); }catch(e){}
  const html = `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title><body style="font:14px system-ui"><h1>Unsubscribed</h1><p>${email} will no longer receive outreach from CG Alert.</p></body>`;
  return new Response(html, { headers: {'content-type':'text/html; charset=utf-8'} });
}

async function handleStripe(request, env){
  if (request.method !== 'POST') return new Response('Method not allowed', {status:405});
  const raw = await request.text();
  const sig = request.headers.get('stripe-signature') || '';
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('Webhook not configured', {status:501});
  if (!verifyStripeSig(raw, sig, env.STRIPE_WEBHOOK_SECRET)) return new Response('Signature mismatch', {status:400});
  let evt; try{ evt = JSON.parse(raw); }catch(e){ return new Response('Bad payload', {status:400}); }

  if (evt.type === 'checkout.session.completed') {
    const s = evt.data && evt.data.object || {};
    const email = (s.customer_details && s.customer_details.email) || s.customer_email || '';
    const amount_total = s.amount_total || 0;
    const currency = (s.currency||'').toUpperCase();
    const session_id = s.id || evt.id;
    const plan_guess = (s.payment_link || '').includes('renewal') || (s.payment_link||'').includes('business') ? 'business' : 'portfolio';
    const rec = { session_id, email, amount_total, currency, plan: plan_guess, at: new Date().toISOString() };
    await env.KV.put(`stripe:session:${session_id}`, JSON.stringify(rec));
    if (email) await env.KV.put(`customer:${email.toLowerCase()}:${session_id}`, JSON.stringify(rec));
    try{ if (env.SLACK_WEBHOOK_URL) await fetch(env.SLACK_WEBHOOK_URL, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({text:`💸 Stripe checkout: ${email} ${amount_total/100} ${currency} (${plan_guess})`})}); }catch(e){}
  }

  return new Response('ok', {status:200});
}

// Stripe signature verification (v1 timestamped)
function verifyStripeSig(payload, sigHeader, secret){
  try{
    const parts = Object.fromEntries(sigHeader.split(',').map(x=>x.split('=')));
    const t = parts['t'], v1 = parts['v1'];
    if (!t || !v1) return false;
    const data = `${t}.${payload}`;
    const enc = new TextEncoder().encode(data);
    const key = crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
    return crypto.subtle.sign('HMAC', key, enc).then(sig=>{
      const hex = [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('');
      // Constant-time compare (approx)
      return hex.length===v1.length && [...hex].every((ch,i)=>ch===v1[i]);
    });
  }catch(e){ return false; }
}

async function verifyHMAC(email, token, secret){
  const alg = { name: "HMAC", hash: "SHA-256" };
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret||''), alg, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(email)));
  const hex = [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,24);
  return hex === token;
}
