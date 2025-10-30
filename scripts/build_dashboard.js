#!/usr/bin/env node
/**
 * build_dashboard.js
 * Rebuild dashboard/index.html from contents of evidence/* (not public/evidence).
 */
const fs = require("fs");
const path = require("path");

function listEvidence(){
  const root = path.join("evidence");
  const vendors = fs.existsSync(root) ? fs.readdirSync(root) : [];
  const data = [];
  for (const v of vendors) {
    const vdir = path.join(root, v);
    if (!fs.statSync(vdir).isDirectory()) continue;
    const captures = fs.readdirSync(vdir).filter(x => /\d{4}-\d{2}-\d{2}T/.test(x)).sort();
    if (captures.length === 0) continue;
    const latest = captures[captures.length - 1];
    data.push({ vendor: v, latest });
  }
  return data.sort((a,b)=>a.vendor.localeCompare(b.vendor));
}

function renderDashboard(rows){
  const items = rows.map(r => {
    const url = `/evidence/${encodeURIComponent(r.vendor)}/${encodeURIComponent(r.latest)}/index0.html`;
    return `<li style="margin-bottom:.5rem;">
<strong>${r.vendor}</strong> — latest: <code>${r.latest}</code>
<a href="${url}" style="margin-left:.5rem;">view</a>
</li>`;
  }).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CG Alert — Evidence Dashboard</title>
<link rel="canonical" href="/dashboard/">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header style="padding:16px;border-bottom:1px solid #eee;">
  <a href="/" style="text-decoration:none;font-weight:600;">CG Alert</a>
  <nav style="float:right;display:flex;gap:12px;">
    <a href="/reports/">Reports</a>
    <a href="/who-uses/">Who Uses</a>
    <a href="/rss.xml" rel="nofollow">RSS</a>
  </nav>
</header>

<main class="wrap" style="max-width:900px;margin:24px auto;padding:0 16px;">
  <h1>Evidence Dashboard</h1>
  <p class="muted">Latest captures by vendor (from <code>/evidence</code>).</p>
  <ul>${items}</ul>
</main>
</body>
</html>`;
  return html;
}

(function main(){
  const rows = listEvidence();
  fs.mkdirSync("dashboard", { recursive: true });
  fs.writeFileSync(path.join("dashboard", "index.html"), renderDashboard(rows), "utf8");
  console.log("[build_dashboard] dashboard/index.html rebuilt with", rows.length, "vendors");
})();
