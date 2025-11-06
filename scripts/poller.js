
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
  return html.replace(/\s+/g," ").replace(/<!--.*?-->/g,"").trim();
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
  // customers.csv (root) format: email,company,plan,cadence,vendors (comma domains)
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

async function fetchPage(url) {
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), CONFIG.timeout_ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": CONFIG.user_agent }, signal: ctrl.signal });
    const html = await res.text();
    return { status: res.status, html };
  } catch (e) {
    return { status: 0, html: "" };
  } finally {
    clearTimeout(t);
  }
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

async function writeEvidenceItem(vendor, key, item) {
  const ts = item.confirmed_at || item.first_seen_at || nowIso();
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
          await writeEvidenceItem(vendor, key, pending);
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
