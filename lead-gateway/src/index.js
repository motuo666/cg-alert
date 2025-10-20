export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, GET, OPTIONS',
          'access-control-allow-headers': 'content-type'
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/lead') {
      let payload = {}
      try {
        const ct = request.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          payload = await request.json();
        } else if (ct.includes('application/x-www-form-urlencoded')) {
          const formData = await request.formData();
          for (const [k,v] of formData.entries()) payload[k] = v;
        } else {
          return new Response(JSON.stringify({ ok: false, error: 'Unsupported content-type' }), {
            status: 415,
            headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
          });
        }
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'Invalid payload' }), {
          status: 400,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
        });
      }

      if (payload._hp) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
      }

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const rec = {
        id,
        ts: now,
        ua: request.headers.get('user-agent') || '',
        ip: request.headers.get('cf-connecting-ip') || '',
        referer: request.headers.get('referer') || '',
        ...payload
      };

      try {
        await env.LEADS.put(`lead:${id}`, JSON.stringify(rec), { expirationTtl: 90 * 24 * 3600 });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'KV write failed' }), {
          status: 500,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
        });
      }

      return new Response(JSON.stringify({ ok: true, id }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
      });
    }

    return new Response('Not found', { status: 404, headers: { 'access-control-allow-origin': '*' } });
  }
}
