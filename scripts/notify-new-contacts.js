// scripts/notify-new-contacts.js (hardened)
const nodemailer = require("nodemailer");
const fetch = require("node-fetch");

const {
  CF_ACCOUNT_ID, KV_NAMESPACE_ID, CF_API_TOKEN,
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
  ADMIN_TOKEN, WORKER_URL
} = process.env;

function transport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || "465", 10),
    secure: (parseInt(SMTP_PORT || "465", 10) === 465),
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function cfGet(path, isJson=true) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/${path}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } });
  if (!resp.ok) throw new Error(`CF GET ${path} ${resp.status}`);
  return isJson ? JSON.parse(await resp.text()) : await resp.text();
}

async function listKeys(prefix) {
  let cursor, out=[];
  do {
    const q = new URLSearchParams({ prefix, ...(cursor?{cursor}:{} ) }).toString();
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys?${q}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } });
    const json = await resp.json();
    if (!json.success) throw new Error("KV list failed " + JSON.stringify(json));
    out.push(...json.result);
    cursor = json.result_info && json.result_info.cursor;
  } while (cursor);
  return out;
}

async function getJsonByKey(key) {
  const url = `values/${encodeURIComponent(key)}`;
  const txt = await cfGet(url, false);
  try { return JSON.parse(txt); } catch { return null; }
}

async function markSent(key) {
  // try worker endpoint
  try {
    const r = await fetch(`${WORKER_URL.replace(/\/+$/,'')}/mark_sent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN },
      body: JSON.stringify({ key })
    });
    if (r.ok) return;
  } catch (e) {}

  // fallback: read-modify-write via KV API
  const raw = await cfGet(`values/${encodeURIComponent(key)}`, false);
  let obj; try { obj = JSON.parse(raw); } catch { return; }
  obj.emailed = true;
  const putUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  await fetch(putUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "text/plain" },
    body: JSON.stringify(obj)
  });
}

async function sendEmail(to, subject, text) {
  const t = transport();
  await t.sendMail({ from: SMTP_USER, to, subject, text });
}

async function processLead(key, obj) {
  if (obj.emailed) return;
  const email = obj.contactEmail || obj.email;
  if (!email) return;
  const vendors = obj.vendors || "";
  const msg = [
    `We got your request.`,
    ``,
    `How this works:`,
    `1. We monitor the vendors you care about (pricing / SLA / liability / DPA / subprocessors).`,
    `2. We send timestamped evidence + escalation language you can paste directly into renewal.`,
    `3. Fully async. No calls.`,
    ``,
    `You listed: ${vendors || "(no vendors yet)"}`,
    ``,
    `— CG Alert`,
  ].join("\n");
  await sendEmail(email, "CG Alert intake received", msg);
  await markSent(key);
}

async function processSale(key, obj) {
  if (obj.emailed) return;
  const email = obj.purchaserEmail || obj.email;
  if (!email) return;
  const msg = [
    `You're in.`,
    ``,
    `We'll send timestamped evidence of pricing / SLA / liability / DPA / subprocessor changes,`,
    `plus escalation language you can paste straight into renewal.`,
    ``,
    `If you want us to watch specific vendors (Portfolio covers up to 3 you name), just reply with the vendor names.`,
    ``,
    `— CG Alert`,
  ].join("\n");
  await sendEmail(email, "CG Alert access", msg);
  await markSent(key);
}

async function processLegacyIntake(key, txt) {
  // legacy intake record: raw json string with fields ts,email,company, vendors, notes
  try {
    const obj = JSON.parse(txt);
    if (!obj || !obj.email) return;
    // promote to normalized lead:<id>
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    const rec = { id, type:"lead", company: obj.company||"", contactEmail: obj.email, vendors: obj.vendors||"", notes: obj.notes||"", ts: obj.ts||new Date().toISOString(), emailed:false, source:"legacy" };
    // cannot write new record without WRITE token here; skip write but still send
    const vendors = rec.vendors;
    const msg = [
      `We got your request.`,
      ``,
      `How this works:`,
      `1. We monitor the vendors you care about (pricing / SLA / liability / DPA / subprocessors).`,
      `2. We send timestamped evidence + escalation language you can paste directly into renewal.`,
      `3. Fully async. No calls.`,
      ``,
      `You listed: ${vendors || "(no vendors yet)"}`,
      ``,
      `— CG Alert`,
    ].join("\n");
    await sendEmail(rec.contactEmail, "CG Alert intake received", msg);
    await markSent(key); // mark legacy intake as emailed to avoid dupes
  } catch {}
}

async function main() {
  // new normalized records
  const leadKeys = await listKeys("lead:");
  for (const k of leadKeys) {
    const obj = await getJsonByKey(k.name);
    if (obj) await processLead(k.name, obj);
  }

  const saleKeys = await listKeys("sale:");
  for (const k of saleKeys) {
    const obj = await getJsonByKey(k.name);
    if (obj) await processSale(k.name, obj);
  }

  // legacy "intake:" records (raw payload); send once and mark emailed
  const intakeKeys = await listKeys("intake:");
  for (const k of intakeKeys) {
    const raw = await cfGet(`values/${encodeURIComponent(k.name)}`, false);
    if (raw && !/\"emailed\"\s*:\s*true/.test(raw)) {
      await processLegacyIntake(k.name, raw);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
