#!/usr/bin/env node
/**
 * poll_public_endpoints.js
 *
 * Crawl all URLs in config/endpoints.json, snapshot content, compute hash,
 * and write timestamped evidence HTML into public/evidence/<vendor>/<ts>/index.html
 * Append entry into artifacts/daily_ops.json.
 *
 * Safe-mode behavior:
 * - If fetch or write fails, log and continue (never throw).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function readJson(fp, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fp,"utf8"));
  } catch {
    return fallback;
  }
}

async function grab(url) {
  try {
    const res = await fetch(url,{method:"GET"});
    const txt = await res.text();
    return txt;
  } catch (err) {
    console.log("[poll_public_endpoints] fetch fail", url, err.message);
    return "";
  }
}

function sha256(str) {
  return crypto.createHash("sha256").update(str,"utf8").digest("hex");
}

function writeFileSafe(fp, body) {
  fs.mkdirSync(path.dirname(fp), {recursive:true});
  fs.writeFileSync(fp, body, "utf8");
}

function loadDailyOps(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp,"utf8"));
  } catch {
    return {events:[]};
  }
}

function saveDailyOps(fp, data) {
  fs.mkdirSync(path.dirname(fp),{recursive:true});
  fs.writeFileSync(fp, JSON.stringify(data,null,2)+"\n","utf8");
}

(async ()=>{
  const endpointsMap = readJson(path.join("config","endpoints.json"), {});
  const ts = new Date().toISOString().replace(/[:.]/g,"-");
  const dailyOpsPath = path.join("artifacts","daily_ops.json");
  const dailyOps = loadDailyOps(dailyOpsPath);

  for (const vendor of Object.keys(endpointsMap)) {
    const urls = endpointsMap[vendor] || [];
    const vendorDir = path.join("public","evidence",vendor,ts);
    let combinedNotes = [];
    let i = 0;
    for (const url of urls) {
      const body = await grab(url);
      const hash = sha256(body || "EMPTY");
      const snippetSafe = body
        .slice(0,2000)
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;");

      const html = `
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${vendor} – snapshot ${ts}</title>
<body style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;font-size:.9rem;line-height:1.4;color:#111;padding:1rem;">
<h1 style="font-size:1rem;font-weight:600;margin:0 0 1rem 0;">${vendor}</h1>
<div style="font-size:.8rem;color:#555;">Source URL: ${url}</div>
<div style="font-size:.8rem;color:#555;">Captured: ${ts}</div>
<div style="font-size:.8rem;color:#555;">SHA256: ${hash}</div>
<pre style="white-space:pre-wrap;font-size:.7rem;color:#000;background:#f9f9f9;border:1px solid #ddd;border-radius:4px;padding:.5rem;margin-top:1rem;">${snippetSafe}</pre>
</body></html>
`;
      try {
        const targetFile = path.join(vendorDir, `index${i}.html`);
        writeFileSafe(targetFile, html);
        combinedNotes.push({url,hash,ts});
      } catch(e){
        console.log("[poll_public_endpoints] write fail", vendor, e.message);
      }
      i++;
    }

    if (combinedNotes.length) {
      dailyOps.events.push({
        type: "snapshot",
        vendor,
        captured_at: ts,
        notes: combinedNotes
      });
    }
  }

  saveDailyOps(dailyOpsPath, dailyOps);
  console.log("[poll_public_endpoints] done", ts);
})().catch(err=>{
  console.error("[poll_public_endpoints] fatal", err);
  process.exit(0);
});
