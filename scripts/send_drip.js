/**
 * send_drip.js (optimized for growth)
 * - Language routing (EN default; CN if strong CN signal)
 * - Subject A/B per stage using stable bucket from lid
 * - Adds preheader text support
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
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
function bucket2(str) { // stable 0/1 bucket
  const h = crypto.createHash("sha1").update(String(str || "")).digest();
  return (h[0] ^ h[1] ^ h[2]) & 1;
}
function pickLang(lead) {
  const e = String(lead.email || "").toLowerCase();
  const cn = e.endsWith(".cn") ||
             /(^|_|-)cn($|_|-)/.test(lead?.first_touch?.utm_source || "") ||
             /(^|_|-)cn($|_|-)/.test(lead?.last_touch?.utm_source || "") ||
             /\.cn\b/.test(lead?.first_touch?.referrer || "") ||
             /\.cn\b/.test(lead?.last_touch?.referrer || "") ||
             /\.cn\b/.test(lead?.first_touch?.landing_url || "") ||
             /\.cn\b/.test(lead?.last_touch?.landing_url || "");
  return cn ? "zh" : "en";
}

const stageDefs = {
  d0: {
    subject: {
      zh: ["CG Alert — 欢迎上车：证据卡样例 + 下一步", "欢迎加入 CG Alert：真实案例与下一步"],
      en: ["CG Alert — Welcome: proof-backed samples + next step", "Welcome to CG Alert — real cases & next step"]
    },
    file: { zh: "drip_d0.html", en: "en/drip_d0.html" },
  },
  d2: {
    subject: {
      zh: ["客户如何用我们拿到谈判筹码（真实案例）", "两天回访：把证据卡变现为谈判优势"],
      en: ["How teams use us for renewal leverage (real cases)", "Day 2: Turn evidence cards into negotiation leverage"]
    },
    file: { zh: "drip_d2.html", en: "en/drip_d2.html" },
  },
  d7: {
    subject: {
      zh: ["最后一封：现在开始，或预约 15 分钟演示", "最后提醒：3 件事让你一周内见效"],
      en: ["Last message: start now or book 15-min demo", "Final nudge: 3 things to see value this week"]
    },
    file: { zh: "drip_d7.html", en: "en/drip_d7.html" },
  },
};

function loadTemplate(relPath) {
  const p = path.join("config", "email_templates", relPath);
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

      const lang = pickLang(lead);
      const tplHtml = loadTemplate(stageDefs[stage].file[lang]);
      const b = bucket2(lead.lid || lead.email);
      const subj = stageDefs[stage].subject[lang][b];

      const unsubToken = hmacHex(UNSUB_HMAC_SECRET, lead.email.toLowerCase());
      const unsubUrl = `${WORKER_URL}/u?e=${encodeURIComponent(lead.email)}&t=${unsubToken}`;
      const lid = lead.lid || "";
      const ctaUrl = `${(SITE_ORIGIN || "https://www.cg-alert.com")}/?utm_source=email&utm_medium=drip&utm_campaign=${stage}&lid=${encodeURIComponent(lid)}`;

      const preheader = "Monitor vendor changes with verifiable evidence cards. Negotiate with facts.";

      const html = renderTemplate(tplHtml, {
        lead, cta_url: ctaUrl, unsub_url: unsubUrl,
        site_origin: SITE_ORIGIN || "https://www.cg-alert.com",
        preheader
      });

      try {
        await sendMail({
          host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS,
          from: MAIL_FROM, to: lead.email, subject: subj, html
        });
        lead.drip = lead.drip || { sent: [] };
        if (!lead.drip.sent.includes(stage)) lead.drip.sent.push(stage);
        lead.updated_at = new Date().toISOString();
        await kv.put(key, JSON.stringify(lead));
        sentCounters[stage]++;
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
