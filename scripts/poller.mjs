
/**
 * Real Poller with two-stage confirmation.
 * - Reads vendor domains from customers.csv and data/seed_domains.txt (if present).
 * - For each vendor, checks selected public URLs (pricing/terms/dpa/subprocessors/security/status).
 * - Computes SHA256 on normalized HTML; if different from last confirmed hash,
 *   creates/updates a pending record. Only when the same new hash is observed again
 *   within confirm_window_hours, it writes a CONFIRMED evidence item.
 * - Writes evidence JSON files and calls lightweight renderers and rss builder separately
 *   (done in workflow steps).
 * Node 20+ required (global fetch).
 */
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://www.cg-alert.com";
const ROOT = process.cwd();
const CONFIG = JSON.parse(await fs.readFile(path.join("config","monitor_paths.json"),"utf-8"));

const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function normalizeHtml(html) {
  // Strip scripts, styles, comments, and obvious banners before diffing to avoid noise-only alerts
  let cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<div[^>]+class="[^"]*(cookie|banner)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  return cleaned.replace(/\s+/g," ").trim();
}

async function readTextIfExists(p) {
  try { return await fs.readFile(p, "utf-8"); } catch { return null; }
}

async function fileExists(p) {
  try { await fs.stat(p); return true; } catch { return false; }
}

async function ensureDir(d) { await fs.mkdir(d, { recursive: true }); }

function nowIso() { return new Date().toISOString(); }

function domainFromUrl(u) {
  try { return new URL(u).hostname; } catch { return null; }
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
}

async function readVendors() {
  const set = new Set();

  // 1) Optional: fetch live customer vendor domains from an external API
  // This lets us keep customer/vendor configuration outside the repo (e.g. in a Worker + D1),
  // while still supporting the original CSV + seed_domains.txt flow as a fallback.
  const apiUrl = process.env.CUSTOMER_VENDORS_URL;
  if (apiUrl) {
    try {
      const url = new URL(apiUrl);
      console.log("[poller] fetching customer vendors from", url.origin + url.pathname);
      const headers = { "accept": "application/json" };
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url.toString(), { headers, signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        console.warn("[poller] CUSTOMER_VENDORS_URL responded with", res.status);
      } else {
        const data = await res.json();
        // Two accepted shapes:
        // { vendors: ["openai.com","notion.so", ...] }
        // or { customers: [{ vendors: ["a.com","b.com"] }, ...] }
        const addDomain = (dom) => {
          if (!dom) return;
          const d = String(dom).trim().toLowerCase();
          if (d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) set.add(d);
        };
        if (Array.isArray(data.vendors)) {
          for (const dom of data.vendors) addDomain(dom);
        }
        if (Array.isArray(data.customers)) {
          for (const c of data.customers) {
            const vs = c && c.vendors;
            if (Array.isArray(vs)) {
              for (const dom of vs) addDomain(dom);
            } else if (typeof vs === "string") {
              for (const dom of vs.split(/[,;]/)) addDomain(dom);
            }
          }
        }
        console.log("[poller] CUSTOMER_VENDORS_URL added", set.size, "domains so far");
      }
    } catch (err) {
      console.warn("[poller] CUSTOMER_VENDORS_URL fetch failed:", err && err.message || err);
    }
  }

  // 2) Original CSV + seed_domains.txt sources (kept for compatibility)
  // customers.csv (root) format: email,company,plan,cadence,vendors (comma/semicolon domains)
  const customersPath = path.join("customers.csv");
  const seedPath = path.join("data","seed_domains.txt");
  for (const p of [customersPath, seedPath]) {
    const txt = await readTextIfExists(p);
    if (!txt) continue;
    for (const line of txt.split(/\r?\n/)) {
      const l = line.trim();
      if (!l) continue;
      if (p.endsWith(".csv")) {
        // vendors column = last column
        if (l.startsWith("#")) continue;
        const cells = l.split(",");
        const last = cells[cells.length-1] || "";
        for (const dom of last.split(/;|,/)) {
          const d = dom.trim().toLowerCase();
          if (d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) set.add(d);
        }
      } else {
        // seed domains
        if (l.startsWith("#")) continue;
        if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(l)) set.add(l.toLowerCase());
      }
    }
  }
  return Array.from(set).slice(0, CONFIG.vendor_limit_per_poll);
}
}

async function fetchPage(url) {
  const maxAttempts = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CONFIG.timeout_ms);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": CONFIG.user_agent },
        signal: ctrl.signal
      });
      const html = await res.text();
      // For 2xx/3xx we always return immediately
      if (res.status >= 200 && res.status < 400) {
        clearTimeout(t);
        return { status: res.status, html };
      }
      // For 429 / 5xx we retry a couple of times with backoff
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        await sleep(500 * attempt);
        clearTimeout(t);
        continue;
      }
      clearTimeout(t);
      return { status: res.status, html };
    } catch (e) {
      lastErr = e;
      clearTimeout(t);
      if (attempt >= maxAttempts) {
        break;
      }
      await sleep(500 * attempt);
    }
  }
  return { status: 0, html: "" };
}

async function readJson(p) { return JSON.parse(await fs.readFile(p,"utf-8")); }
async function writeJson(p, obj) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(obj, null, 2), "utf-8");
}

async function readPending(vendor, key) {
  const p = path.join("evidence",".pending", vendor, key + ".json");
  try { return await readJson(p); } catch { return null; }
}
async function writePending(vendor, key, obj) {
  const p = path.join("evidence",".pending", vendor, key + ".json");
  await writeJson(p, obj);
}
async function removePending(vendor, key) {
  const p = path.join("evidence",".pending", vendor, key + ".json");
  try { await fs.unlink(p); } catch {}
}

async function lastConfirmedHashPath(vendor, key) {
  // store last-confirmed hash for fast compare
  return path.join("evidence",".confirmed",vendor,key+".hash");
}
async function readLastConfirmedHash(vendor, key) {
  const p = await lastConfirmedHashPath(vendor, key);
  try { return (await fs.readFile(p,"utf-8")).trim(); } catch { return ""; }
}
async function writeLastConfirmedHash(vendor, key, h) {
  const p = await lastConfirmedHashPath(vendor, key);
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, h+"\n", "utf-8");
}


async function uploadEvidenceHtmlToR2(vendor, key, ts, html) {
  const base = (process.env.R2_EVIDENCE_WRITE_URL || "").trim();
  if (!base) return null;
  if (!html || !html.trim()) return null;

  const safeVendor = String(vendor || "unknown").toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  const safeKey = String(key || "page").toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  const tsPart = String(ts || nowIso()).replace(/[:.]/g, "-");

  const objectKey = `${safeVendor}/${safeKey}/${tsPart}.html`;
  const endpoint = base.replace(/\/$/, "") + "/" + encodeURIComponent(objectKey);

  const headers = {
    "Content-Type": "text/html; charset=utf-8"
  };
  const apiKey = (process.env.R2_EVIDENCE_API_KEY || "").trim();
  if (apiKey) headers["x-api-key"] = apiKey;

  try {
    const res = await fetch(endpoint, {
      method: "PUT",
      headers,
      body: html
    });
    if (!res.ok) {
      console.warn("R2 upload failed", res.status);
      return { key: objectKey, url: null };
    }
    let data = null;
    try { data = await res.json(); } catch {}
    const url = data && (data.url || data.location || null);
    return { key: objectKey, url: url || null };
  } catch (e) {
    console.warn("R2 upload error", String(e && e.message || e));
    return { key: objectKey, url: null };
  }
}

async function writeEvidenceItem(vendor, key, item, rawHtml) {
  const ts = item.confirmed_at || item.first_seen_at || nowIso();
  // Best-effort upload of raw HTML to R2 (optional)
  if (rawHtml && (process.env.R2_EVIDENCE_WRITE_URL || "").trim()) {
    try {
      const r2 = await uploadEvidenceHtmlToR2(vendor, key, ts, rawHtml);
      if (r2 && r2.key) {
        item.r2_key = r2.key;
        if (r2.url) item.r2_url = r2.url;
      }
    } catch (e) {
      console.warn("R2 upload soft-fail", String(e && e.message || e));
    }
  }
  const p = path.join("evidence", vendor, key, ts.replace(/[:.]/g,"-") + ".json");
  await writeJson(p, item);
}

function extractSnippet(html) {
  // grab first 240 chars of text
  const text = html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
  return text.slice(0, 240);
}

async function main() {
  const vendors = await readVendors();
  if (!vendors.length) {
    console.log("No vendors found in customers.csv or data/seed_domains.txt");
    return;
  }

  const paths = CONFIG.paths;
  for (const vendor of vendors) {
    for (const pth of paths.slice(0, CONFIG.per_vendor_page_limit)) {
      const url = `https://${vendor}${pth}`;
      const key = slugify(pth === "/" ? "home" : pth);
      const { status, html } = await fetchPage(url);
      await sleep(CONFIG.inter_request_ms);

      if (status === 0) {
        console.log(`[${vendor}] fetch timeout/error: ${url}`);
        continue;
      }
      const norm = normalizeHtml(html);
      const h = sha256(norm);
      const lastConfirmed = await readLastConfirmedHash(vendor, key);

      if (h === lastConfirmed) {
        // no change vs confirmed
        await removePending(vendor, key);
        continue;
      }

      // detect/confirm change
      const pending = await readPending(vendor, key);
      const now = nowIso();
      if (!pending || pending.new_hash !== h) {
        // create/overwrite pending
        const item = {
          vendor, url, page: pth, key,
          old_hash: lastConfirmed || "",
          new_hash: h,
          first_seen_at: now,
          confirmed_at: null,
          status_code: status,
          snippet: extractSnippet(html)
        };
        await writePending(vendor, key, item);
        console.log(`[${vendor}] pending change: ${url}`);
      } else {
        // same change seen again — confirm if within window
        const first = new Date(pending.first_seen_at).getTime();
        const deltaH = (Date.now() - first) / 3600000;
        if (deltaH <= CONFIG.confirm_window_hours) {
          pending.confirmed_at = now;
          await writeEvidenceItem(vendor, key, pending, html);
          await writeLastConfirmedHash(vendor, key, pending.new_hash);
          await removePending(vendor, key);
          console.log(`[${vendor}] CONFIRMED change: ${url}`);
        } else {
          // window expired; reset to new pending
          pending.first_seen_at = now;
          await writePending(vendor, key, pending);
        }
      }
    }
  }

  // write lightweight heartbeat file for downstream steps
  await ensureDir("evidence");
  await fs.writeFile(path.join("evidence","_last_poll.json"), JSON.stringify({ at: nowIso(), vendors: vendors.length }, null, 2));
}

await main();
