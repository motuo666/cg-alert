#!/usr/bin/env node
/**
 * workflows_doctor.js
 *
 * Sanity check for required workflows, write artifacts/workflows_report.txt
 */

const fs = require("fs");
const path = require("path");

const REQUIRED = [
  "stabilize.yml",
  "intake-sync.yml",
  "outreach-triggered.yml",
  "bounce-sweep.yml",
  "suppression-sync.yml",
  "evidence-harvest.yml",
  "lead-enrich.yml",
  "weekly-health-check.yml",
  "workflows-doctor.yml",
  "check-secrets.yml",
  "pricing-sync.yml",
  "legal-health.yml",
  "vendor-expand.yml",
  "target-discovery.yml"
];

(function main(){
  const wfDir = path.join(".github","workflows");
  const present = fs.existsSync(wfDir) ? fs.readdirSync(wfDir) : [];
  const missing = REQUIRED.filter(r=>!present.includes(r));

  const lines = [];
  lines.push("Workflows present: "+present.join(", "));
  if (missing.length) {
    lines.push("MISSING: "+missing.join(", "));
  } else {
    lines.push("All required workflows found.");
  }

  fs.mkdirSync("artifacts",{recursive:true});
  fs.writeFileSync(path.join("artifacts","workflows_report.txt"), lines.join("\n")+"\n","utf8");
  console.log("[workflows_doctor] wrote artifacts/workflows_report.txt");
})();
