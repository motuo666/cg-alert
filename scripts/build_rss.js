#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const glob = require("glob");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "evidence");
const OUT_FILE = path.join(ROOT, "public", "rss.xml");

// 小工具
function escapeXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 哪些 vendor 我们不想放进公开 feed
function shouldPublishVendor(vendor = "") {
  if (!vendor) return false;
  if (vendor.startsWith("_")) return false;        // _seed
  if (vendor === "acme") return false;            // demo
  if (vendor.startsWith("status.")) return false; // status.* 内部噪音
  if (vendor === "status.domain") return false;
  return true;
}

function loadAllEvidenceMeta() {
  const files = glob.sync(path.join(SRC_DIR, "**/*.json"));
  const list = [];

  files.forEach(fp => {
    try {
      const raw = fs.readFileSync(fp, "utf8");
      const data = JSON.parse(raw);
      data.__slug = path.basename(fp).replace(/\.json$/i, ".html"); // e.g. 2025-10-13-DPA-xxxx.html
      data.__vendor = data.vendor;
      list.push(data);
    } catch (e) {
      console.error("skip invalid json:", fp);
    }
  });

  // 依照 detected_at DESC 排序
  list.sort((a, b) => {
    const da = new Date(a.detected_at || 0).getTime();
    const db = new Date(b.detected_at || 0).getTime();
    return db - da;
  });

  return list;
}

function buildRssXml(items) {
  const now = new Date().toUTCString();

  const rssItems = items.slice(0, 60).map(it => {
    const vendor = it.__vendor || "";
    const slug = it.__slug || "unknown.html";

    // permalink：指向我们刚才生成的 pretty evidence 页面
    const permalink = `https://www.cg-alert.com/evidence/${vendor}/${slug}`;

    const detectedDate = (it.detected_at || "").split("T")[0] || "";
    const title = `${vendor} ${it.type || ""} (${detectedDate})`;
    const pubDate = new Date(it.detected_at || Date.now()).toUTCString();

    return [
      "<item>",
      `<title>${escapeXml(title)}</title>`,
      `<link>${escapeXml(permalink)}</link>`,
      `<guid isPermaLink="false">${escapeXml(`${vendor}/${slug}`)}</guid>`,
      `<pubDate>${escapeXml(pubDate)}</pubDate>`,
      "</item>"
    ].join("\n");
  }).join("\n");

  const header = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    "<title>CG Alert — Evidence Feed</title>",
    "<link>https://www.cg-alert.com/</link>",
    '<atom:link href="https://www.cg-alert.com/rss.xml" rel="self" type="application/rss+xml"/>',
    "<description>",
    "High-signal vendor change evidence with cryptographic hash, captured from public sources only (Pricing, ToS/MSA, DPA, Subprocessors, Status). Timestamped for Procurement / Legal Ops / Finance audit. Not legal advice.",
    "</description>",
    "<language>en-us</language>",
    `<lastBuildDate>${escapeXml(now)}</lastBuildDate>`
  ].join("\n");

  const footer = [
    "</channel>",
    "</rss>"
  ].join("\n");

  return header + "\n" + rssItems + "\n" + footer + "\n";
}

// 主逻辑
(function main(){
  const all = loadAllEvidenceMeta();
  const filtered = all.filter(it => shouldPublishVendor(it.vendor));
  const rssXml = buildRssXml(filtered);
  fs.writeFileSync(OUT_FILE, rssXml, "utf8");
  console.log("✅ rss.xml generated with", filtered.length, "items");
})();
