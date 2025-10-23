/**
 * lead-gateway Worker (tight CORS + RL + queues + obs + import)
 * Routes:
 *  - POST /lead      : 表单/CTA，补 UTM/referrer → KV upsert lead:{email}；新线索入队 dripq:d0
 *  - GET  /u         : 一键退订（兼容两种参数）
 *        * 新：/u?e=<email>&t=<HMAC(email)>
 *        * 旧：/u?u=<HMAC(email)>&email=<email>  或  /u?u=<HMAC(email)>
 *  - POST /stripe    : Stripe webhook (checkout.session.completed)，入队 dripq:d2
 *  - GET  /_stats    : 最近 7 天指标（需 x-obs-key）
 *  - GET  /stats     : 同上（向后兼容）
 *  - POST /import    : BuildWith/技术画像名单导入（CSV/JSON），需 x-obs-key/x-import-key，入队 dripq:outbound
 *
 * Bindings:
 *  - KV: LEADS
 *  - Vars: ALLOWED_ORIGINS, SITE_ORIGIN(可选)
 *  - Secrets: UNSUB_HMAC_SECRET, STRIPE_WEBHOOK_SECRET,
 *             SLACK_WEBHOOK_URL(可选), OBS_KEY(推荐), IMPORT_KEY(可选)
 */

export default {
  async fetch(request, env, ctx) {
    const url  = new URL(request.url);
    const path = url.pathname;

    // ---------- CORS allowlist (only for /lead) ----------
    const allowedSet = parseAllowed(env.ALLOWED_ORIGINS || env.SITE_ORIGIN || "https://www.cg-alert.com,https://cg-alert.com");

    if (path === "/lead") {
      const origin = request.headers.get("origin");
      const allowedOrigin = origin && allowedSet.has(origin) ? origin : null;

      if (request.method === "OPTIONS") {
        if (!allowedOrigin) return denyCORS();
        return corsPreflight(allowedOrigin);
      }
      if (request.method === "POST") {
        if (!allowedOrigin) return denyCORS();
        const res = await handleLead(request, env);
        return withCORS(res, allowedOrigin);
      }
      return new Response("method not allowed", { status: 405 });
    }

    // 退订（兼容新旧两种参数）
    if (path === "/u" && request.method === "GET") {
      return await handleUnsub(request, env);
    }

    // Stripe Webhook
    if (path === "/stripe") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      return await handleStripe(request, env);
    }

    // 统计（两个路径都支持）
    if ((path === "/_stats" || path === "/stats") && request.method === "GET") {
      return await handleStats(request, env);
    }

    // BuildWith / 技术画像导入（CSV/JSON）
    if ((path === "/import" || path === "/import/buildwith") && request.method === "POST") {
      return await handleImport(request, env);
    }

    if (path === "/healthz") return jsonOK({ ok: true });

    return jsonOK({ ok: true, ping: "lead-gateway" });
  }
};

/* -------------------- Observability helpers -------------------- */

function nowIso() { return new Date().toISOString(); }

async function sha1Hex(s) {
  const data = new TextEncoder().encode(s || "");
  const digest = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function baseLog(req, extra = {}) {
  const url = new URL(req.url);
  return { ts: nowIso(), cf_ray: req.headers.get("cf-ray") || "", route: url.pathname, method: req.method, ...extra };
}

async function logJSON(req, level, extra = {}) {
  try {
    const ua = req.headers.get("user-agent") || "";
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "";
    const b = baseLog(req, extra);
    b.level = level;
    b.ua_hash = await sha1Hex(ua);
    b.ip_hash = await sha1Hex(ip);
    console.log(JSON.stringify(b));
  } catch {}
}

async function slack(env, text) {
  if (!env.SLACK_WEBHOOK_URL) return;
  try {
    await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    });
  } catch {}
}

// day counter in KV: key = stats:YYYY-MM-DD:name
async function incStat(env, name, n = 1) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const key = `stats:${day}:${name}`;
    const cur = await env.LEADS.get(key);
    const val = (cur ? parseInt(cur, 10) : 0) + n;
    await env.LEADS.put(key, String(val), { expirationTtl: 60 * 60 * 24 * 15 });
  } catch {}
}

/* -------------------- CORS helpers -------------------- */
function parseAllowed(list) {
  return new Set(String(list || "").split(",").map(s => s.trim()).filter(Boolean));
}
function corsPreflight(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
      "vary": "Origin"
    }
  });
}
function withCORS(res, origin) {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", origin);
  h.set("access-control-allow-methods", "POST,OPTIONS");
  h.set("access-control-allow-headers", "content-type");
  h.set("vary", "Origin");
  return new Response(res.body, { status: res.status, headers: h });
}
function denyCORS() { return jsonErr(403, "origin_not_allowed"); }

/* -------------------- JSON helpers -------------------- */
function jsonOK(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
function jsonErr(status, msg) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

/* -------------------- Route handlers -------------------- */

async function handleLead(request, env) {
  const t0 = Date.now();
  await logJSON(request, "info", { event: "lead_recv" });

  const url = new URL(request.url);
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  let body = {};
  try {
    if (ct.includes("application/json")) {
      body = await request.json();
    } else if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      const form = await request.formData();
      form.forEach((v, k) => (body[k] = v));
    }
  } catch (e) {
    await logJSON(request, "error", { event: "lead_bad_body", err: String(e) });
    await incStat(env, "errors", 1);
    return jsonErr(400, "bad_body");
  }

  const email = String((body.email || body.Email || body.e || "").toLowerCase().trim());
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await logJSON(request, "error", { event: "lead_invalid_email" });
    await incStat(env, "errors", 1);
    return jsonErr(400, "invalid_email");
  }
  const emailHash = await sha1Hex(email);

  // 基于 IP+email 的 5 分钟轻量限流（>3 次 -> 429）
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "0.0.0.0";
  try {
    const rlKey = `ratelimit:${ip}:${email}`;
    const cur = parseInt((await env.LEADS.get(rlKey)) || "0", 10);
    if (cur >= 3) {
      await incStat(env, "rate_limited", 1);
      await logJSON(request, "warn", { event: "lead_rate_limited", email_hash: emailHash });
      return jsonErr(429, "too_many_requests");
    }
    await env.LEADS.put(rlKey, String(cur + 1), { expirationTtl: 300 });
  } catch {}

  // lead id cookie
  const cookieIn = request.headers.get("cookie") || "";
  const cookies = Object.fromEntries(
    cookieIn.split(";").map(s => s.trim().split("=").map(decodeURIComponent)).filter(x => x[0])
  );
  let lid = cookies["cg_lead_id"] || body["cg_lead_id"] || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

  // UTM/referrer enrichment
  const utm = {
    utm_source: body.utm_source || url.searchParams.get("utm_source") || "",
    utm_medium: body.utm_medium || url.searchParams.get("utm_medium") || "",
    utm_campaign: body.utm_campaign || url.searchParams.get("utm_campaign") || "",
    utm_content: body.utm_content || url.searchParams.get("utm_content") || "",
    utm_term: body.utm_term || url.searchParams.get("utm_term") || "",
  };
  const now = nowIso();
  const referrer = body.referrer || request.headers.get("referer") || "";
  const landing_url = body.landing_url || (referrer || (env.SITE_ORIGIN ? `${env.SITE_ORIGIN}/` : ""));
  const ua = request.headers.get("user-agent") || "";

  const key = `lead:${email}`;
  let existing = await env.LEADS.get(key, { type: "json" });
  let isNew = false;

  if (!existing) {
    isNew = true;
    existing = {
      email, lid, status: "new", unsub: false, bounced: false,
      first_touch: { ...utm, referrer, landing_url, ts: now },
      last_touch:  { ...utm, referrer, landing_url, ts: now },
      ua_first: ua,
      ip_hash: await sha256Hex(ip),
      touches: [],
      drip: { sent: [] },
      created_at: now,
      updated_at: now,
    };
  } else {
    existing.last_touch = { ...utm, referrer, landing_url, ts: now };
    existing.updated_at = now;
    if (!existing.lid) existing.lid = lid;
  }

  existing.touches.push({ ts: now, ...utm, referrer, landing_url });

  await env.LEADS.put(key, JSON.stringify(existing), { expirationTtl: 60 * 60 * 24 * 365 * 3 });

  // 新线索 -> 入队 D0（按小时滚动前缀，TTL 7 天）
  if (isNew) {
    const hour = new Date().toISOString().slice(0,13).replace(/[-:T]/g,'');
    await env.LEADS.put(`dripq:d0:${hour}:${email}`, '1', { expirationTtl: 7*24*3600 });
  }

  // set cookie
  const isHttps = (new URL(request.url)).protocol === "https:";
  const cookieFlags = `Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax` + (isHttps ? "; Secure" : "");
  const res = jsonOK({ ok: true, lid, email });
  res.headers.set("set-cookie", `cg_lead_id=${encodeURIComponent(lid)}; ${cookieFlags}`);

  await incStat(env, isNew ? "lead_new" : "lead_touch", 1);
  await logJSON(request, "info", { event: "lead_ok", email_hash: emailHash, new: isNew, ms: Date.now() - t0 });
  return res;
}

async function handleUnsub(request, env) {
  const t0 = Date.now();
  await logJSON(request, "info", { event: "unsub_recv" });

  const url = new URL(request.url);
  // 新：e(email)+t(token)；旧：u(token)+email(email 可选)
  const eParam = (url.searchParams.get("e") || url.searchParams.get("email") || "").toLowerCase();
  const tParam = url.searchParams.get("t") || url.searchParams.get("u") || ""; // 兼容 ?u
  const email = eParam;
  const token = tParam;

  if (!token) {
    await logJSON(request, "error", { event: "unsub_missing_token" });
    await incStat(env, "errors", 1);
    return new Response("Missing token", { status: 400 });
  }

  // 更安全：必须带 email（避免 KV 逆向）
  if (!email) {
    await logJSON(request, "error", { event: "unsub_missing_email" });
    return new Response("Missing email", { status: 400 });
  }

  const ok = await hmacVerify(env.UNSUB_HMAC_SECRET, email, token);
  if (!ok) {
    await logJSON(request, "error", { event: "unsub_bad_token" });
    await incStat(env, "errors", 1);
    return new Response("Invalid token", { status: 403 });
  }

  const key = `lead:${email}`;
  let lead = await env.LEADS.get(key, { type: "json" });
  if (!lead) {
    await logJSON(request, "info", { event: "unsub_no_record" });
    return new Response("OK (no record)", { status: 200 });
  }

  lead.unsub = true;
  lead.status = "unsub";
  lead.updated_at = nowIso();
  await env.LEADS.put(key, JSON.stringify(lead), { expirationTtl: 60 * 60 * 24 * 365 * 3 });

  await incStat(env, "unsub", 1);
  await logJSON(request, "info", { event: "unsub_ok", email_hash: await sha1Hex(email), ms: Date.now() - t0 });
  return new Response("You have been unsubscribed. ✔", { headers: { "content-type": "text/plain; charset=utf-8" } });
}

async function handleStripe(request, env) {
  const t0 = Date.now();
  await logJSON(request, "info", { event: "stripe_recv" });

  const raw = await request.text();
  const sig = request.headers.get("stripe-signature") || "";
  if (!sig) {
    await logJSON(request, "error", { event: "stripe_missing_sig" });
    await incStat(env, "errors", 1);
    return new Response("Missing signature", { status: 400 });
  }

  // 兼容多 v1 值（任意一个匹配即通过）
  const pairs = sig.split(",").map(s => s.trim().split("=", 2));
  const t = (pairs.find(([k]) => k === "t") || [,""])[1] || "";
  const v1s = pairs.filter(([k]) => k === "v1").map(([,v]) => v).filter(Boolean);

  if (!t || !v1s.length) {
    await logJSON(request, "error", { event: "stripe_bad_sig_hdr" });
    await incStat(env, "errors", 1);
    return new Response("Bad signature header", { status: 400 });
  }

  const signedPayload = `${t}.${raw}`;
  const digest = await hmacHex(env.STRIPE_WEBHOOK_SECRET, signedPayload);
  if (!v1s.some(v => timingSafeEqualHex(v, digest))) {
    await logJSON(request, "error", { event: "stripe_sig_mismatch" });
    await incStat(env, "errors", 1);
    return new Response("Signature mismatch", { status: 400 });
  }

  let event = {};
  try { event = JSON.parse(raw || "{}"); }
  catch (e) {
    await logJSON(request, "error", { event: "stripe_bad_json", err: String(e) });
    await incStat(env, "errors", 1);
    return new Response("bad json", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data?.object || {};
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
          period_start: session.subscription ? undefined : nowIso(),
          period_end: undefined,
          ts: nowIso(),
        };
        lead.updated_at = nowIso();

        await env.LEADS.put(key, JSON.stringify(lead), { expirationTtl: 60 * 60 * 24 * 365 * 3 });

        // 入队 D2（按小时滚动）
        const hour = new Date().toISOString().slice(0,13).replace(/[-:T]/g,'');
        await env.LEADS.put(`dripq:d2:${hour}:${email}`, '1', { expirationTtl: 7*24*3600 });

        await incStat(env, "stripe_ok", 1);
        await logJSON(request, "info", { event: "stripe_ok", type: event.type, email_hash: await sha1Hex(email), amount: lead.purchase.amount, ms: Date.now() - t0 });

        if (env.SLACK_WEBHOOK_URL) {
          const amt = (lead.purchase.amount / 100).toFixed(2);
          const cur = (lead.purchase.currency || "usd").toUpperCase();
          await slack(env, `💸 Stripe checkout completed: ${email} — ${lead.purchase.plan} ${amt} ${cur}`);
        }
      }
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    await logJSON(request, "error", { event: "stripe_fail", err: String(e), ms: Date.now() - t0 });
    await incStat(env, "errors", 1);
    await slack(env, `Stripe ERROR: ${String(e).slice(0, 200)}`);
    return new Response("bad", { status: 400 });
  }
}

// BuildWith / 技术画像导入：CSV/JSON 批量导入，写 lead:{email} 并入队 dripq:outbound
async function handleImport(request, env) {
  const keyHdr = request.headers.get("x-import-key") || request.headers.get("x-obs-key") || "";
  const allowKey = env.IMPORT_KEY || env.OBS_KEY || "";
  if (!allowKey || keyHdr !== allowKey) return jsonErr(403, "forbidden");

  const ct = (request.headers.get("content-type") || "").toLowerCase();
  let items = [];
  if (ct.includes("application/json")) {
    const body = await request.json();
    items = Array.isArray(body) ? body : (body.items || []);
  } else {
    const text = await request.text();
    items = parseCSV(text); // 允许 CSV
  }

  const hour = new Date().toISOString().slice(0,13).replace(/[-:T]/g,'');
  let imported = 0, skipped = 0;
  for (const it of items) {
    const email = (it.email||"").toLowerCase().trim();
    if (!email) { skipped++; continue; }
    const key = `lead:${email}`;
    let obj = {};
    try { obj = JSON.parse((await env.LEADS.get(key)) || "{}"); } catch {}

    if (!obj.status || (obj.status!=="unsub" && obj.status!=="suppressed" && obj.status!=="bounced")) {
      obj.status = obj.status==="new" ? "verified" : (obj.status||"verified");
    }
    obj.email = email;
    obj.company = it.company || obj.company || "";
    obj.domain  = it.domain  || obj.domain  || "";
    obj.source  = "buildwith";
    const a = Array.isArray(obj.tech) ? obj.tech : [];
    const b = Array.isArray(it.tech) ? it.tech : (it.tech ? [it.tech] : []);
    obj.tech = Array.from(new Set([...a, ...b].filter(Boolean)));
    obj.cg_lead_id = obj.cg_lead_id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    obj.touches = obj.touches || [];
    obj.touches.push({ ts: Date.now(), source:"buildwith", domain: obj.domain, company: obj.company });

    await env.LEADS.put(key, JSON.stringify(obj), { expirationTtl: 60 * 60 * 24 * 365 * 3 });
    await env.LEADS.put(`dripq:outbound:${hour}:${email}`, '1', { expirationTtl: 7*24*3600 });
    imported++;
  }
  await incStat(env, "import", imported);
  return jsonOK({ imported, skipped });
}

function parseCSV(text) {
  const lines = String(text||"").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const head = lines.shift().split(',').map(s=>s.trim().toLowerCase());
  const idx = k => head.indexOf(k);
  const out = [];
  for (const ln of lines) {
    const cols = ln.split(',');
    const email   = (cols[idx('email')]  || '').trim().toLowerCase();
    const domain  = (cols[idx('domain')] || '').trim().toLowerCase();
    const company = (cols[idx('company')]|| '').trim();
    const techRaw = (cols[idx('tech')]   || '');
    const tech = techRaw.split(/;|,/).map(s=>s.trim()).filter(Boolean);
    if (email) out.push({ email, domain, company, tech });
  }
  return out;
}

async function handleStats(request, env) {
  // 保护：x-obs-key = env.OBS_KEY（推荐）或 UNSUB_HMAC_SECRET 的前 16 位（兜底）
  const provided = request.headers.get("x-obs-key") || "";
  const want = (env.OBS_KEY || env.UNSUB_HMAC_SECRET || "").slice(0, 16);
  if (!want || provided !== want) return new Response("forbidden", { status: 403 });

  const out = {};
  for (let i = 0; i < 7; i++) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    for (const name of ["lead_new", "lead_touch", "unsub", "stripe_ok", "errors", "rate_limited", "import"]) {
      const k = `stats:${day}:${name}`;
      out[`${day}.${name}`] = parseInt(await env.LEADS.get(k) || "0", 10);
    }
  }
  return jsonOK(out);
}

/* -------------------- crypto helpers -------------------- */
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
function hex(buf) { return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join(""); }
function timingSafeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
