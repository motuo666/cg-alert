#!/usr/bin/env node
/**
 * expand_endpoints.js
 *
 * Goal:
 *  - Use current targets/customers to auto-suggest monitored endpoints
 *    (pricing, terms, dpa, subprocessor, status, etc.)
 *  - Merge suggestions into config/endpoints.json (dedupe).
 *
 * Inputs:
 *   config/targets.csv
 *   data/customers.csv (optional; used to infer domains)
 *
 * Output:
 *   config/endpoints.json (updated in-place)
 *
 * This makes vendor coverage grow automatically, which feeds the moat.
 */

const fs = require("fs");
const path = require("path");

function readCsv(fp) {
  if (!fs.existsSync(fp)) return [];
  const txt = fs.readFileSync(fp,"utf8");
  const lines = txt.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const hdr = lines[0].split(",");
  return lines.slice(1).map(line=>{
    const cols = line.split(",");
    const o={};
    hdr.forEach((h,i)=>o[h]=(cols[i]||"").trim());
    return o;
  });
}

function readJson(fp, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fp,"utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), {recursive:true});
  fs.writeFileSync(fp, JSON.stringify(obj,null,2)+"\n","utf8");
}

function guessDomainFromRow(r) {
  // explicit 'domain'
  if (r.domain) return r.domain.toLowerCase();
  // infer from email
  if (r.email && r.email.includes("@")) {
    return r.email.split("@")[1].toLowerCase();
  }
  return "";
}

const patterns = [
  "/pricing",
  "/legal/terms",
  "/terms",
  "/legal/privacy",
  "/privacy",
  "/legal/dpa",
  "/legal/data-processing-addendum",
  "/legal/data-processing-agreement",
  "/security/subprocessors",
  "/legal/subprocessors",
  "/subprocessors",
  "/legal/sub-processors",
  "/status",
  "/statuspage"
];

(function main(){
  const targets = readCsv(path.join("config","targets.csv"));
  const custs   = readCsv(path.join("data","customers.csv"));
  const allDomainsSet = new Set();

  for (const t of targets) {
    const d = guessDomainFromRow(t);
    if (d) allDomainsSet.add(d);
    if (t.domain) allDomainsSet.add(t.domain.toLowerCase());
  }
  for (const c of custs) {
    const d = guessDomainFromRow(c);
    if (d) allDomainsSet.add(d);
  }

  const allDomains = Array.from(allDomainsSet).filter(Boolean);

  const endpointsPath = path.join("config","endpoints.json");
  const endpointsMap = readJson(endpointsPath, {});

  for (const domain of allDomains) {
    if (!endpointsMap[domain]) endpointsMap[domain] = [];
    const list = new Set(endpointsMap[domain]);
    for (const p of patterns) {
      list.add(`https://${domain}${p}`);
    }
    endpointsMap[domain] = Array.from(list);
  }

  writeJson(endpointsPath, endpointsMap);
  console.log("[expand_endpoints] domains:", allDomains.length, "updated endpoints.json");
})();
