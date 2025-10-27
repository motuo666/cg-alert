#!/usr/bin/env node
/**
 * build_dashboard.js
 *
 * Rebuild dashboard/index.html from contents of public/evidence.
 * Lists vendors and latest capture timestamps.
 */

const fs = require("fs");
const path = require("path");

function listEvidence(){
  const root = path.join("public","evidence");
  const vendors = fs.existsSync(root) ? fs.readdirSync(root) : [];
  const data = [];
  for (const v of vendors) {
    const vendorDir = path.join(root,v);
    if (!fs.statSync(vendorDir).isDirectory()) continue;
    const stamps = fs.readdirSync(vendorDir).filter(x=>{
      const p = path.join(vendorDir,x);
      return fs.statSync(p).isDirectory();
    }).sort().reverse();
    const latest = stamps[0] || "";
    data.push({vendor:v, latest});
  }
  return data.sort((a,b)=>a.vendor.localeCompare(b.vendor));
}

function renderDashboard(rows){
  const listItems = rows.map(r=>{
    return `<li style="margin-bottom:.5rem;">
<strong>${r.vendor}</strong> &mdash; latest: <code>${r.latest}</code>
<a href="/public/evidence/${r.vendor}/${r.latest}/index0.html" style="color:#0645ad;text-decoration:underline;margin-left:.5rem;">view</a>
</li>`;
  }).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>CG Alert – Evidence Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;line-height:1.5;color:#111;padding:1rem;max-width:48rem;margin:0 auto;}
h1{font-size:1.1rem;font-weight:600;margin:0 0 1rem 0;}
.card{border:1px solid #ddd;border-radius:6px;background:#f9f9f9;padding:1rem;margin-top:1rem;}
.btnrow{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.75rem;}
.btn{display:inline-block;background:#111;color:#fff;padding:.5rem .75rem;border-radius:4px;font-size:.8rem;text-decoration:none;}
.btn.alt{background:#0a7cff;}
.small{font-size:.8rem;color:#555;}
</style>
</head>
<body>

<h1>Vendor Change Evidence Dashboard</h1>
<p style="font-size:.9rem;margin:0 0 1rem 0;">
Live, timestamped captures of pricing / terms / DPA / sub-processors / SLA changes.
Use this as leverage in renewal and compliance review.
</p>

<div class="card">
  <div style="font-size:.9rem;font-weight:600;margin-bottom:.5rem;">Ready to lock leverage before renewal?</div>
  <div class="btnrow">
    <a class="btn" href="/buy/portfolio">Buy Portfolio · $2,988/yr</a>
    <a class="btn alt" href="/intake">Request Enterprise</a>
  </div>
  <div class="small" style="margin-top:.5rem;">
    Portfolio = prebuilt evidence library + ongoing monitoring.<br/>
    Enterprise = tailored vendor set, alerts, and contract support.
  </div>
</div>

<h2 style="font-size:1rem;font-weight:600;margin:2rem 0 .5rem 0;">Captured Vendors</h2>
<ul style="font-size:.9rem;list-style:disc;padding-left:1.2rem;">
${listItems || "<li>No captures yet</li>"}
</ul>

</body>
</html>`;
  return html;
}

(function main(){
  const rows = listEvidence();
  const outHtml = renderDashboard(rows);
  fs.mkdirSync("dashboard",{recursive:true});
  fs.writeFileSync(path.join("dashboard","index.html"), outHtml,"utf8");
  console.log("[build_dashboard] dashboard/index.html rebuilt with", rows.length, "vendors");
})();
