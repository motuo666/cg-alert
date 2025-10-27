#!/usr/bin/env node
/**
 * weekly_health_check.js
 *
 * Basic self-check: ensure key pages exist and _redirects has buy/intake.
 * Writes artifacts/health_report.txt with summary.
 */

const fs = require("fs");
const path = require("path");

(function main(){
  const report = [];
  function ok(msg){ report.push("OK: "+msg); }
  function warn(msg){ report.push("WARN: "+msg); }

  // check index.html
  if (fs.existsSync("index.html")) ok("index.html present"); else warn("index.html missing");

  // check _redirects
  if (fs.existsSync("_redirects")) {
    const body = fs.readFileSync("_redirects","utf8");
    if (/\/buy\/portfolio/.test(body)) ok("_redirects has /buy/portfolio");
    else warn("_redirects missing /buy/portfolio");
    if (/\/intake/.test(body)) ok("_redirects has /intake");
    else warn("_redirects missing /intake");
  } else {
    warn("_redirects missing");
  }

  // write report file
  fs.mkdirSync("artifacts",{recursive:true});
  fs.writeFileSync(path.join("artifacts","health_report.txt"), report.join("\n")+"\n","utf8");
  console.log("[weekly_health_check] wrote artifacts/health_report.txt");
})();
