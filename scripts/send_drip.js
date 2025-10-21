/**
 * send_drip.js
 * Schedules: D0 (immediate), D2 (48h), D7 (168h)
 * Env required: CF_ACCOUNT_ID, KV_NAMESPACE_ID, CF_API_TOKEN, SITE_ORIGIN,
 *               SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM,
 *               WORKER_URL, UNSUB_HMAC_SECRET
 */
import fs from "fs";
import path from "path";
import API from "./lib/cfkv.js";
import { sendMail, renderTemplate, hmacHex } from "./lib/email.js";

const {
  CF_ACCOUNT_ID, KV_NAMESPACE_ID, CF_API_TOKEN, SITE_ORIGIN,
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM,
  WORKER_URL, UNSUB_HMAC_SECRET
} = process.env;

if (!CF_ACCOUNT_ID || !KV_NAMESPACE_ID || !CF_API_TOKEN) throw new Error("Missing CF credentials");
if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_FROM) throw new Error("Missing SMTP creds");
if (!WORKER_URL || !UNSUB_HMAC_SECRET) throw new Error("Missing WORKER_URL/UNSUB_HMAC_SECRET");

const kv = API(CF_ACCOUNT_ID, KV_NAMESPACE_ID, CF_API_TOKEN);

function hoursBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 36e5;
}

const templates = {
  d0: {
    subject: "CG Alert — 欢迎上车：证据卡样例 + 下一步",
    file: "drip_d0.html",
  },
  d2: {
    subject: "CG Alert — 客户如何用我们拿到谈判筹码（真实案例）",
    file: "drip_d2.html",
  },
  d7: {
    subject: "CG Alert — 最后一封：直接开始 or 预约 15 分钟",
    file: "drip_d7.html",
  },
};

function loadTemplate(name) {
  const p = path.join("config", "email_templates", name);
  return fs.readFileSync(p, "utf-8");
}

async function main() {
  let cursor;
  const batchSize = 1000;
  const sentCounters = { d0:0, d2:0, d7:0 };
  while (true) {
    const listRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys?prefix=lead%3A&limit=${batchSize}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
      headers: { "Authorization": `Bearer ${CF_API_TOKEN}` }
    }).then(r => r.json());
    if (!listRes.success) throw new Error("KV list failed: " + JSON.stringify(listRes));

    for (const item of listRes.result) {
      const key = item.name;
      const value = await kv.get(key);
      if (!value) continue;
      const lead = safeJson(value);
      if (!lead || !lead.email) continue;
      if (lead.unsub || lead.bounced) continue;
      if (!lead.created_at) lead.created_at = lead.first_touch?.ts || new Date().toISOString();

      const now = new Date().toISOString();
      const ageH = hoursBetween(lead.created_at, now);
      const sent = lead.drip?.sent || [];

      let stage = null;
      if (!sent.includes("d0")) stage = "d0";
      else if (ageH >= 48 && !sent.includes("d2")) stage = "d2";
      else if (ageH >= 168 && !sent.includes("d7")) stage = "d7";

      if (!stage) continue;

      const tplHtml = loadTemplate(templates[stage].file);
      const unsubToken = hmacHex(UNSUB_HMAC_SECRET, lead.email.toLowerCase());
      const unsubUrl = `${WORKER_URL}/u?e=${encodeURIComponent(lead.email)}&t=${unsubToken}`;
      const lid = lead.lid || "";
      const ctaUrl = `${(SITE_ORIGIN || "https://www.cg-alert.com")}/?utm_source=email&utm_medium=drip&utm_campaign=${stage}&lid=${encodeURIComponent(lid)}`;

      const html = renderTemplate(tplHtml, {
        lead,
        cta_url: ctaUrl,
        unsub_url: unsubUrl,
        site_origin: SITE_ORIGIN || "https://www.cg-alert.com",
      });

      try {
        await sendMail({
          host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS,
          from: MAIL_FROM, to: lead.email,
          subject: templates[stage].subject, html
        });
        lead.drip = lead.drip || { sent: [] };
        if (!lead.drip.sent.includes(stage)) lead.drip.sent.push(stage);
        lead.updated_at = new Date().toISOString();
        await kv.put(key, JSON.stringify(lead));
        sentCounters[stage]++;
        // throttling a bit
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error("Send failed for", lead.email, err);
      }
    }

    if (!listRes.result_info?.cursor) break;
    cursor = listRes.result_info.cursor;
  }

  console.log("Drip sent counters:", sentCounters);
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

main().catch(e => { console.error(e); process.exit(1); });
