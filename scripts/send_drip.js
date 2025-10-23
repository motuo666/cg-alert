/**
 * send_drip.js — drop-in replacement (safe, idempotent-ish)
 * - Lang routing (EN default; fallback to ZH/placeholder if EN missing)
 * - Subject A/B via stable 0/1 bucket from lid/email
 * - Preheader + List-Unsubscribe headers
 * - Retry with backoff; lightweight per-lead stage lock
 * - Rate limit via SEND_RATE (emails/min), default 20
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import API from "./lib/cfkv.js";
import { sendMail, renderTemplate, hmacHex } from "./lib/email.js";

const {
  CF_ACCOUNT_ID, KV_NAMESPACE_ID, CF_API_TOKEN, SITE_ORIGIN,
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM,
  REPLY_TO, BCC_TO,
  WORKER_URL, UNSUB_HMAC_SECRET,
  SEND_RATE, // 可选：每分钟发件上限，默认 20
} = process.env;

// ---- sanity checks ----
if (!CF_ACCOUNT_ID || !KV_NAMESPACE_ID || !CF_API_TOKEN)
  throw new Error("Missing CF credentials (CF_ACCOUNT_ID/KV_NAMESPACE_ID/CF_API_TOKEN)");
if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_FROM)
  throw new Error("Missing SMTP creds (SMTP_HOST/SMTP_USER/SMTP_PASS/MAIL_FROM)");
if (!WORKER_URL || !UNSUB_HMAC_SECRET)
  throw new Error("Missing WORKER_URL/UNSUB_HMAC_SECRET");

const kv = API(CF_ACCOUNT_ID, KV_NAMESPACE_ID, CF_API_TOKEN);

const NOW = () => new Date().toISOString();
const HOURS_BETWEEN = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 36e5;

function bucket2(seed) {
  const h = crypto.createHash("sha1").update(String(seed || "")).digest();
  return (h[0] ^ h[1] ^ h[2]) & 1; // 0/1
}

function pickLang(lead) {
  const e = String(lead.email || "").toLowerCase();
  const cn =
    e.endsWith(".cn") ||
    /(^|_|-)cn($|_|-)/i.test(lead?.first_touch?.utm_source || "") ||
    /(^|_|-)cn($|_|-)/i.test(lead?.last_touch?.utm_source || "") ||
    /\.cn\b/i.test(lead?.first_touch?.referrer || "") ||
    /\.cn\b/i.test(lead?.last_touch?.referrer || "") ||
    /\.cn\b/i.test(lead?.first_touch?.landing_url || "") ||
    /\.cn\b/i.test(lead?.last_touch?.landing_url || "");
  return cn ? "zh" : "en";
}

const stageDefs = {
  d0: {
    subject: {
      zh: ["CG Alert — 欢迎上车：证据卡样例 + 下一步", "欢迎加入 CG Alert：真实案例与下一步"],
      en: ["CG Alert — Welcome: proof-backed samples + next step", "Welcome to CG Alert — real cases & next step"],
    },
    file: { zh: "drip_d0.html", en: "en/drip_d0.html" },
  },
  d2: {
    subject: {
      zh: ["客户如何用我们拿到谈判筹码（真实案例）", "两天回访：把证据卡变现为谈判优势"],
      en: ["How teams use us for renewal leverage (real cases)", "Day 2: Turn evidence cards into negotiation leverage"],
    },
    file: { zh: "drip_d2.html", en: "en/drip_d2.html" },
  },
  d7: {
    subject: {
      zh: ["最后一封：现在开始，或预约 15 分钟演示", "最后提醒：3 件事让你一周内见效"],
      en: ["Last message: start now or book 15-min demo", "Final nudge: 3 things to see value this week"],
    },
    file: { zh: "drip_d7.html", en: "en/drip_d7.html" },
  },
};

// safe template loader: EN -> fallback ZH -> placeholder
function loadTemplate(relPath) {
  const p = path.join("config", "email_templates", relPath);
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    if (relPath.includes("/en/")) {
      const zh = path.join("config", "email_templates", relPath.replace("/en/", "/"));
      if (fs.existsSync(zh)) {
        console.warn("[drip] EN template missing, fall back to ZH:", relPath);
        return fs.readFileSync(zh, "utf-8");
      }
    }
    console.warn("[drip] Template missing, use minimal placeholder:", relPath);
    return `<!doctype html><meta charset="utf-8">
      <div style="font-family:system-ui,Segoe UI,Arial;line-height:1.6">
        <p>Hi, this is CG Alert.</p>
        <p><a href="{{cta_url}}">Continue</a> · <a href="{{unsub_url}}">Unsubscribe</a></p>
        <span style="display:none;opacity:0;color:#fff">{{preheader}}</span>
      </div>`;
  }
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ""));
}

function listUnsubHeaders(unsubUrl) {
  return {
    "List-Unsubscribe": `<${unsubUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// basic backoff retry
async function withRetry(fn, tries = 3, baseMs = 300) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { last = e; await sleep(baseMs * Math.pow(1.8, i)); }
  }
  throw last;
}

// rate limit: SEND_RATE emails per minute (default 20)
const RATE = Math.max(1, Number(SEND_RATE || "20"));
let sentInWindow = 0;
let windowStart = Date.now();
async function ratelimit() {
  sentInWindow++;
  const elapsed = Date.now() - windowStart;
  if (sentInWindow >= RATE) {
    if (elapsed < 60_000) await sleep(60_000 - elapsed);
    sentInWindow = 0; windowStart = Date.now();
  }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  let cursor;
  const batchSize = 1000;
  const sentCounters = { d0: 0, d2: 0, d7: 0 };
  const site = SITE_ORIGIN || "https://cg-alert.com";

  while (true) {
    const url =
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys` +
      `?prefix=lead%3A&limit=${batchSize}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const listRes = await fetch(url, {
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    }).then(r => r.json());

    if (!listRes?.success) throw new Error("KV list failed: " + JSON.stringify(listRes));

    for (const item of (listRes.result || [])) {
      const key = item.name;
      const value = await kv.get(key);
      if (!value) continue;

      const lead = safeJson(value);
      if (!lead || !validEmail(lead.email)) continue;
      if (lead.unsub || lead.bounced) continue;

      lead.created_at ||= lead.first_touch?.ts || NOW();
      const ageH = HOURS_BETWEEN(lead.created_at, NOW());
      const sent = lead.drip?.sent || [];
      let stage = null;

      if (!sent.includes("d0")) stage = "d0";
      else if (ageH >= 48 && !sent.includes("d2")) stage = "d2";
      else if (ageH >= 168 && !sent.includes("d7")) stage = "d7";
      if (!stage) continue;

      // lightweight lock to avoid double-send in overlapping runs
      const lock = lead.drip?.lock;
      if (lock && lock.stage === stage && HOURS_BETWEEN(lock.ts, NOW()) < 10) {
        // another runner is handling it
        continue;
      }
      lead.drip = lead.drip || { sent: [] };
      lead.drip.lock = { stage, ts: NOW() };
      await kv.put(key, JSON.stringify(lead));

      const lang = pickLang(lead);
      const tplHtml = loadTemplate(stageDefs[stage].file[lang]);
      const b = bucket2(lead.lid || lead.email);
      const subject = stageDefs[stage].subject[lang][b];

      const unsubToken = hmacHex(UNSUB_HMAC_SECRET, String(lead.email || "").toLowerCase());
      const unsubUrl = `${WORKER_URL}/u?e=${encodeURIComponent(lead.email)}&t=${unsubToken}`;
      const lid = lead.lid || "";
      const ctaUrl = `${site}/?utm_source=email&utm_medium=drip&utm_campaign=${stage}&lid=${encodeURIComponent(lid)}`;
      const preheader =
        lang === "zh"
          ? "用可核验的证据卡跟踪供应商变更，用事实赢下谈判。"
          : "Monitor vendor changes with verifiable evidence cards. Negotiate with facts.";

      const html = renderTemplate(tplHtml, {
        lead, cta_url: ctaUrl, unsub_url: unsubUrl, site_origin: site, preheader, stage,
      });

      try {
        await withRetry(() =>
          sendMail({
            host: SMTP_HOST,
            port: Number(SMTP_PORT || 587),
            user: SMTP_USER,
            pass: SMTP_PASS,
            from: MAIL_FROM,             // e.g. "CG Alerts <ops@cg-alert.com>"
            replyTo: REPLY_TO || "ops@cg-alert.com",
            bcc: BCC_TO || undefined,
            to: lead.email,
            subject,
            html,
            headers: listUnsubHeaders(unsubUrl),
          })
        );

        // success → record sent & release lock
        lead.drip.sent = Array.from(new Set([...(lead.drip.sent || []), stage]));
        delete lead.drip.lock;
        lead.updated_at = NOW();
        await kv.put(key, JSON.stringify(lead));
        sentCounters[stage]++;

        // respect provider rate limit
        await ratelimit();
      } catch (err) {
        console.error(JSON.stringify({
          level: "error", route: "drip", email_hash: sha1(lead.email),
          stage, msg: String(err?.message || err)
        }));
        // release lock on failure so next run retries
        if (lead?.drip?.lock) delete lead.drip.lock;
        await kv.put(key, JSON.stringify(lead));
        // 轻微退避，避免瞬时反复失败
        await sleep(500);
      }
    }

    if (!listRes.result_info?.cursor) break;
    cursor = listRes.result_info.cursor;
  }

  console.log(JSON.stringify({ level: "info", route: "drip", sent: sentCounters, rate: RATE }));
}

// utils
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
function sha1(s) { return crypto.createHash("sha1").update(String(s || "")).digest("hex"); }

main().catch(e => { console.error(e); process.exit(1); });
