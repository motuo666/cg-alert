export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
      return new Response("ok", { status: 200 });
    }

    // --- Lead intake (JSON) ---
    if (request.method === "POST" && (url.pathname === "/intake_lead" || url.pathname === "/api/intake")) {
      try {
        const body = await request.json();
        const company = body.company || "";
        const contactEmail = (body.email || "").toLowerCase();
        const vendors = body.vendors || "";
        const notes = body.notes || "";
        const id = crypto.randomUUID();
        const ts = new Date().toISOString();

        const rec = { id, type:"lead", company, contactEmail, vendors, notes, ts, emailed:false, source:"api" };
        await env.CGALERT_KV.put(`lead:${id}`, JSON.stringify(rec));

        return Response.json({ ok:true, id });
      } catch (e) {
        return new Response("bad json", { status: 400 });
      }
    }

    // --- Lead intake (HTML form) ---
    if (request.method === "POST" && (url.pathname === "/intake" || url.pathname === "/form")) {
      const form = await request.formData();
      const contactEmail = (form.get("email") || "").toLowerCase();
      const company = form.get("company") || "";
      const vendors = form.get("vendors") || form.get("message") || "";
      const notes = form.get("notes") || "";
      const id = crypto.randomUUID();
      const ts = new Date().toISOString();

      // keep legacy "intake:" record for existing scripts
      const legacy = JSON.stringify({ ts, email: contactEmail, company, vendors, notes });
      await env.CGALERT_KV.put(`intake:${ts}:${contactEmail}`, legacy);

      // new normalized record
      const rec = { id, type:"lead", company, contactEmail, vendors, notes, ts, emailed:false, source:"form" };
      await env.CGALERT_KV.put(`lead:${id}`, JSON.stringify(rec));

      return new Response("ok", { status: 200 });
    }

    // --- Stripe webhook → sale record (we don't verify signature here to keep free MVP simple) ---
    if (request.method === "POST" && (url.pathname === "/stripe_webhook" || url.pathname === "/api/stripe")) {
      const raw = await request.text();
      let evt; try { evt = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
      const t = evt.type || "";
      if (t !== "checkout.session.completed" && t !== "invoice.payment_succeeded") return new Response("ignored", { status: 200 });

      let purchaserEmail = "";
      if (evt.data && evt.data.object) {
        const obj = evt.data.object;
        purchaserEmail = (obj.customer_details && obj.customer_details.email) || obj.customer_email || obj.receipt_email || "";
      }

      const id = crypto.randomUUID();
      const ts = new Date().toISOString();
      const rec = { id, type:"sale", purchaserEmail, stripeEvent:t, ts, emailed:false, source:"stripe" };
      await env.CGALERT_KV.put(`sale:${id}`, JSON.stringify(rec));
      return new Response("ok", { status: 200 });
    }

    // --- Admin dump (JSON) ---
    if (request.method === "GET" && url.pathname === "/admin_dump") {
      const token = url.searchParams.get("token") || "";
      if (token !== env.ADMIN_TOKEN) return new Response("forbidden", { status: 403 });

      const leads = await listJson(env.CGALERT_KV, "lead:");
      const sales = await listJson(env.CGALERT_KV, "sale:");
      const intakes = await listRaw(env.CGALERT_KV, "intake:");
      const unsubs = await listRaw(env.CGALERT_KV, "unsub:");
      return Response.json({ leads, sales, intakes, unsubs });
    }

    // --- Mark a record emailed:true (used by GitHub Action) ---
    if (request.method === "POST" && url.pathname === "/mark_sent") {
      const token = request.headers.get("X-Admin-Token") || "";
      if (token !== env.ADMIN_TOKEN) return new Response("forbidden", { status: 403 });

      let payload; try { payload = await request.json(); } catch { return new Response("bad json", { status: 400 }); }
      const key = payload && payload.key;
      if (!key) return new Response("bad request", { status: 400 });
      const val = await env.CGALERT_KV.get(key);
      if (!val) return new Response("not found", { status: 404 });

      try {
        const obj = JSON.parse(val);
        obj.emailed = true;
        await env.CGALERT_KV.put(key, JSON.stringify(obj));
      } catch {
        // not json? skip
      }
      return new Response("ok", { status: 200 });
    }

    // --- Unsubscribe (alias /u and /unsubscribe) ---
    if (request.method === "GET" && (url.pathname === "/u" || url.pathname === "/unsubscribe")) {
      const email = (url.searchParams.get("email") || "").toLowerCase();
      const sig = url.searchParams.get("s") || url.searchParams.get("sig") || "";
      const ts = new Date().toISOString();
      const rec = JSON.stringify({ email, sig, ts });
      await env.CGALERT_KV.put(`unsub:${ts}:${email}`, rec);
      const body = `<html><body style="font-family:system-ui;padding:24px"><h1>You're unsubscribed.</h1><p style="color:#666">We won't email ${email} again.</p></body></html>`;
      return new Response(body, { status: 200, headers: { "content-type":"text/html; charset=utf-8" }});
    }

    // Fallback
    return new Response("CG Alert lead-gateway online", { status: 200 });
  }
};

async function listJson(kv, prefix) {
  const res = await kv.list({ prefix });
  const out = [];
  for (const k of res.keys) {
    const v = await kv.get(k.name);
    try { out.push(JSON.parse(v)); } catch {}
  }
  return out;
}

async function listRaw(kv, prefix) {
  const res = await kv.list({ prefix });
  const out = [];
  for (const k of res.keys) {
    const v = await kv.get(k.name);
    out.push({ key:k.name, value:v });
  }
  return out;
}
