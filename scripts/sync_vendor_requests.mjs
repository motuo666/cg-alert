// scripts/sync_vendor_requests.mjs
// 从 Cloudflare Worker 拉取还未同步的 vendor 请求，写入 data/seed_domains.txt

import fs from "node:fs";
import path from "node:path";
import https from "node:https";

// 简单 https GET + JSON
function fetchJson(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method: "GET",
      headers: {
        "X-CG-Token": token,
        "User-Agent": "cg-alert-sync-vendor-requests",
      },
    };
    const req = https.request(u, opts, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data || "{}");
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function normalizeDomain(s) {
  if (!s) return null;
  s = String(s).trim().toLowerCase();
  // 去掉 scheme
  s = s.replace(/^https?:\/\//, "");
  // 去掉路径
  s = s.split("/")[0];
  // 去掉开头结尾的点
  s = s.replace(/^\.+|\.+$/g, "");
  if (!s.includes(".")) return null;
  return s;
}

async function main() {
  const api = process.env.VENDOR_REQUEST_API;
  const token = process.env.VENDOR_SYNC_TOKEN;

  if (!api) throw new Error("VENDOR_REQUEST_API is required");
  if (!token) throw new Error("VENDOR_SYNC_TOKEN is required");

  const res = await fetchJson(api, token);
  const list = Array.isArray(res.vendors) ? res.vendors : [];
  if (!list.length) {
    console.log("No new vendor requests to sync.");
    return;
  }

  console.log("Got vendors from Worker:", list);

  const ROOT = process.cwd();
  const seedPath = path.join(ROOT, "data", "seed_domains.txt");
  let existing = [];

  if (fs.existsSync(seedPath)) {
    existing = fs
      .readFileSync(seedPath, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const set = new Set(existing);
  for (const raw of list) {
    const d = normalizeDomain(raw);
    if (!d) continue;
    set.add(d);
  }

  const out = Array.from(set).sort().join("\n") + "\n";
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  fs.writeFileSync(seedPath, out, "utf8");

  console.log("Updated seed_domains.txt with", list.length, "vendors.");
}

main().catch((e) => {
  // 网络 / DNS 等临时错误，不要让整个 workflow 挂掉
  const transientCodes = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT"]);
  if (e && e.code && transientCodes.has(e.code)) {
    console.error("sync_vendor_requests: transient network error, skipping sync:", {
      code: e.code,
      hostname: e.hostname,
      syscall: e.syscall,
    });
    // Treat as soft-fail: keep workflow green while上游 API 尚未就绪
    process.exit(0);
    return;
  }

  console.error("sync_vendor_requests failed:", e);
  process.exit(1);
});
