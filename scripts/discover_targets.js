#!/usr/bin/env node
/**
 * discover_targets.js
 *
 * Pulls new ICP companies from an external discovery API based on vertical keywords.
 * Appends them into config/targets.csv (domain,company,region) deduped.
 *
 * ENV:
 *   TARGET_DISCOVERY_API_URL
 *   TARGET_DISCOVERY_API_TOKEN
 *
 * Reads:
 *   config/verticals.json  -> { "verticals":[ {keyword,region}, ...] }
 * Writes:
 *   config/targets.csv     -> deduped list of {domain,company,region}
 *
 * If env not set, it safely exits (so CI won't explode).
 */

const fs = require("fs");
const path = require("path");

const { TARGET_DISCOVERY_API_URL, TARGET_DISCOVERY_API_TOKEN } = process.env;
if (!TARGET_DISCOVERY_API_URL || !TARGET_DISCOVERY_API_TOKEN) {
  console.log("[discover_targets] discovery API not configured; skip");
  process.exit(0);
}

function readJson(fp, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return fallback;
  }
}

function readCsv(fp) {
  if (!fs.existsSync(fp)) return [];
  const txt = fs.readFileSync(fp, "utf8");
  const lines = txt.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const hdr = lines[0].split(",");
  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const obj = {};
    hdr.forEach((h,i)=>obj[h]=(cols[i]||"").trim());
    return obj;
  });
}

function writeCsv(fp, rows, header) {
  const hdr = header || Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const out = [hdr.join(",")];
  for (const r of rows) {
    out.push(
      hdr.map(h => (r[h]??"").toString().replace(/[\r\n,]/g," ")).join(",")
    );
  }
  fs.mkdirSync(path.dirname(fp), {recursive:true});
  fs.writeFileSync(fp, out.join("\n")+"\n", "utf8");
}

async function hitDiscovery(keyword) {
  try {
    const url = TARGET_DISCOVERY_API_URL + encodeURIComponent(keyword);
    const resp = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${TARGET_DISCOVERY_API_TOKEN}`,
        "Accept": "application/json"
      }
    });
    if (!resp.ok) {
      console.log("[discover_targets] API not ok", keyword, resp.status);
      return [];
    }
    const data = await resp.json();
    if (!Array.isArray(data)) return [];
    // normalize
    return data.map(x => ({
      domain: (x.domain||"").toLowerCase(),
      company: x.company || "",
      region: (x.region||"us").toLowerCase()
    })).filter(r => r.domain);
  } catch(e){
    console.log("[discover_targets] API error", keyword, e.message);
    return [];
  }
}

(async () => {
  const verts = readJson(path.join("config","verticals.json"), {verticals:[]}).verticals || [];
  if (!verts.length) {
    console.log("[discover_targets] no verticals.json data; skip");
    process.exit(0);
  }

  const oldRows = readCsv(path.join("config","targets.csv"));
  const merged = oldRows.slice();
  const seen = new Set(oldRows.map(r => (r.domain||"").toLowerCase()).filter(Boolean));

  for (const v of verts) {
    const kw = v.keyword || "";
    const regionHint = (v.region||"").toLowerCase() || "us";
    if (!kw) continue;

    const candidates = await hitDiscovery(kw);

    for (const c of candidates) {
      if (!c.domain) continue;
      if (seen.has(c.domain)) continue;
      seen.add(c.domain);
      merged.push({
        domain: c.domain,
        company: c.company || "Unknown",
        region: c.region || regionHint
      });
      console.log("[discover_targets] add", c.domain, c.company, c.region||regionHint);
    }
  }

  writeCsv(
    path.join("config","targets.csv"),
    merged,
    ["domain","company","region"]
  );
  console.log("[discover_targets] total targets:", merged.length);
})().catch(err=>{
  console.error("[discover_targets] ERR", err && err.stack ? err.stack : err);
  process.exit(0);
});
