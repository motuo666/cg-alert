#!/usr/bin/env node

// 把 evidence/<vendor>/*.json -> public/evidence/<vendor>/*.html
// 这些生成的 *.html 才是 RSS / UI 里应该跳到的人类可读证据页

const fs = require("fs");
const path = require("path");
const glob = require("glob");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "evidence");          // JSON 源
const OUT_ROOT = path.join(ROOT, "public", "evidence"); // HTML 目标
fs.mkdirSync(OUT_ROOT, { recursive: true });

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 生成一条证据详情页 HTML
function renderEvidencePage(meta) {
  const {
    vendor,
    type,
    url,
    kind,
    detected_at,
    etag,
    last_modified,
    sha256,
    hash,
    commit
  } = meta;

  // sha256 有些旧条目可能叫 hash
  const snapHash = sha256 || hash || "";
  // 2025-10-13T06:47:49.240Z -> 2025-10
  const dt = new Date(detected_at || Date.now());
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const monthDir = `${yyyy}-${mm}`;
  const rawCapturePath = snapHash
    ? `/evidence/${monthDir}/${vendor}/${snapHash}/index.html`
    : "#";

  const rows = [
    ["Vendor", vendor || ""],
    ["Type", type || ""],
    ["Kind", kind || ""],
    ["Source URL", url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>` : ""],
    ["Captured at (UTC)", detected_at || ""],
    ["Raw capture", snapHash ? `<a href="${rawCapturePath}" target="_blank" rel="noopener">${escapeHtml(rawCapturePath)}</a>` : ""],
    ["SHA256", snapHash],
    ["Commit", commit || ""],
    ["ETag", etag || ""],
    ["Last-Modified", last_modified || ""],
  ];

  const tableRowsHtml = rows.map(
    ([k, v]) => `
      <tr>
        <th style="text-align:left;vertical-align:top;padding:.5rem .75rem;border-bottom:1px solid var(--border);white-space:nowrap;font-weight:600;color:var(--ink);font-size:.8rem;">${escapeHtml(k)}</th>
        <td style="padding:.5rem .75rem;border-bottom:1px solid var(--border);font-size:.8rem;line-height:1.4;color:var(--ink);word-break:break-word;">${v}</td>
      </tr>`
  ).join("");

  const titleText = `${vendor || ""} ${type || ""} (${yyyy}-${mm}-${dd}) • CG Alert Evidence`;

  // 我们不直接把完整导航写死在这里，而是留占位符给 theme_injector.js
  // /assets/cg-theme.css + /styles.css 也会在后面被 theme_injector / site_doctor 补全/规范
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(titleText)}</title>
</head>
<body>
<!--APP_HEADER-->

<main class="wrap" style="max-width:900px;margin:0 auto;padding:2rem 1rem;">
  <h1 style="font-size:1.25rem;font-weight:600;margin:0 0 1rem;color:var(--ink);line-height:1.3;">
    ${escapeHtml(vendor || "")}
    <span style="font-weight:400;color:#6b7280;">— ${escapeHtml(type || "")}</span>
    <span style="font-weight:400;color:#6b7280;">(${escapeHtml(detected_at || "")})</span>
  </h1>

  <div class="card" style="background:#fff;border:1px solid var(--border);border-radius:var(--radius-card);box-shadow:0 8px 24px rgba(0,0,0,.04);overflow:hidden;">
    <table style="width:100%;border-collapse:collapse;background:#fff;">
      <tbody>
        ${tableRowsHtml}
      </tbody>
    </table>
  </div>

  <p style="margin-top:1rem;font-size:.75rem;color:#6b7280;line-height:1.4;">
    Evidence is captured from public/unauthenticated sources only (Pricing, ToS/MSA, DPA, Subprocessors, Status, etc).
    Timestamped for Procurement / Legal Ops / Finance audit. Not legal advice.
  </p>
</main>

<!--APP_FOOTER-->
</body>
</html>`;
}

// 主逻辑：把所有 JSON 转成 HTML
function buildAll() {
  const jsonFiles = glob.sync(path.join(SRC_DIR, "**/*.json"));
  jsonFiles.forEach(fp => {
    const metaRaw = fs.readFileSync(fp, "utf8");
    let meta;
    try {
      meta = JSON.parse(metaRaw);
    } catch (e) {
      console.error("⚠️  skip (invalid JSON):", fp);
      return;
    }
    const vendor = meta.vendor;
    if (!vendor) {
      console.error("⚠️  skip (no vendor):", fp);
      return;
    }

    // 输出目录 public/evidence/<vendor>/
    const outDir = path.join(OUT_ROOT, vendor);
    fs.mkdirSync(outDir, { recursive: true });

    // 保持文件名一致，只把 .json 后缀改成 .html
    const baseName = path.basename(fp).replace(/\.json$/i, ".html");
    const outFile = path.join(outDir, baseName);

    const html = renderEvidencePage(meta);
    fs.writeFileSync(outFile, html, "utf8");
  });
}

buildAll();
console.log("✅ pretty evidence pages generated.");
