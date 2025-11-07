import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const EVID = path.join(ROOT, "evidence/.confirmed");
const OUT_DIR = path.join(ROOT, "vendors");
fs.mkdirSync(OUT_DIR, { recursive: true });

function collectVendors() {
  if (!fs.existsSync(EVID)) return [];
  return fs.readdirSync(EVID, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
}

function html(layout) {
  return String.raw`${layout}`;
}

const vendors = collectVendors();
// index
const idx = html(`<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vendors · CG Alert</title>
<link rel="canonical" href="/vendors/">
<body style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial">
<main style="max-width:960px;margin:40px auto;padding:0 16px">
  <h1>Vendors (${vendors.length})</h1>
  <p>Browse evidence-backed change timelines by vendor.</p>
  <ul>
    ${vendors.map(v => `<li><a href="/reports/${v}/">/reports/${v}/</a></li>`).join("\n")}
  </ul>
</main>
</body></html>`);
fs.writeFileSync(path.join(OUT_DIR, "index.html"), idx);

// per-vendor jump pages (optional hardening)
for (const v of vendors) {
  const vd = path.join(OUT_DIR, v);
  fs.mkdirSync(vd, { recursive: true });
  const stub = html(`<!doctype html><meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=/reports/${v}/">
<link rel="canonical" href="/reports/${v}/">`);
  fs.writeFileSync(path.join(vd, "index.html"), stub);
}

console.log("vendors index size %d, timelines %d", vendors.length, vendors.length);
