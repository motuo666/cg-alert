#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();
const EJSON_DIR = path.join(ROOT, "evidence"); // 你仓库存放 evidence JSON 的根目录
const PUB = path.join(ROOT, "public", "evidence");

async function* walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.endsWith(".json")) yield p;
  }
}

function monthFromIso(s) { return (s||"").slice(0,7); }
function vendorFromPath(p) {
  const m = p.split(path.sep); // .../evidence/<vendor>/YYYY... .json 也能找回 vendor
  const i = m.lastIndexOf("evidence");
  return i>=0 && i+1<m.length ? m[i+1] : "unknown";
}

async function ensureDir(p){ await fs.mkdir(p, { recursive:true }); }

async function hashBody(buf){ return crypto.createHash("sha256").update(buf).digest("hex"); }

async function fetchSnapshot(u){
  const res = await fetch(u, { redirect: "follow" });
  const buf = Buffer.from(await res.arrayBuffer());
  const etag = res.headers.get("etag");
  const lm = res.headers.get("last-modified");
  const finalUrl = res.url;
  const h = await hashBody(buf);
  return { buf, etag, lm, finalUrl, hash: h };
}

(async ()=>{
  for await (const jf of walk(EJSON_DIR)) {
    const raw = await fs.readFile(jf, "utf8");
    let j; try { j = JSON.parse(raw); } catch { continue; }
    if (j.hash) continue; // 已有 hash 跳过

    const url = j.url;
    const vendor = vendorFromPath(jf);
    const ym = monthFromIso(j.detected_at) || "unknown";

    try {
      const snap = await fetchSnapshot(url);
      const dest = path.join(PUB, ym, vendor, snap.hash);
      await ensureDir(dest);
      await fs.writeFile(path.join(dest, "index.html"), snap.buf);

      j.hash = snap.hash;
      j.url = snap.finalUrl;
      j.etag = snap.etag ?? null;
      j.last_modified = snap.lm ?? null;
      if (j.kind === "baseline" && j.type === "Other") j.type = "Homepage";
      await fs.writeFile(jf, JSON.stringify(j, null, 2));
      console.log("fixed:", jf, "->", snap.hash);
    } catch (e) {
      console.error("fail:", jf, e.message);
    }
  }
  console.log("normalize_evidence done");
})();
