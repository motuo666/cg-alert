// scripts/postbuild_fix_snapshots.js
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

// 可能的构建输出根目录（按顺序尝试）
const CANDIDATE_OUTPUTS = ["public", "dist", "out", "_site"];

// 1x1 webp 占位，避免图片 404
const WEBP_1x1_BASE64 = "UklGRiIAAABXRUJQVlA4WAoAAAABAAAAAQAcAQAAQUxQSAw=";

async function pickOutputRoot() {
  for (const d of CANDIDATE_OUTPUTS) {
    const p = path.join(REPO_ROOT, d);
    try { const st = await fs.stat(p); if (st.isDirectory()) return p; } catch {}
  }
  // 若都不存在，就使用 public（会被创建）
  const fallback = path.join(REPO_ROOT, "public");
  await fs.mkdir(fallback, { recursive: true });
  return fallback;
}

async function globHtml(dir) {
  const out = [];
  async function walk(cur) {
    const ents = await fs.readdir(cur, { withFileTypes: true });
    for (const e of ents) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(cur, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(".html")) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

function extractSnapshotIds(html) {
  // 兼容 “#e3b0c442…” 或 data-* / 文本中出现的 hash
  const ids = new Set();
  // 1) #hash
  for (const m of html.matchAll(/#([a-f0-9]{8,64})/gi)) ids.add(m[1].toLowerCase());
  // 2) data-snapshot="id" / data-hash="id"
  for (const m of html.matchAll(/data-(?:snapshot|hash)=["']([a-f0-9]{8,64})["']/gi))
    ids.add(m[1].toLowerCase());
  return [...ids];
}

function rewriteSnapshotLinks(html, idsInPage) {
  if (!idsInPage.length) return html;
  // 规则：把 href="snapshot" 或 >snapshot< 的链接替换为 /evidence/<第一个id>/
  const first = idsInPage[0];
  let out = html.replace(/href=(["'])snapshot\1/gi, `href="/evidence/${first}/"`);
  out = out.replace(/>(\s*)snapshot(\s*)</gi, `>$1snapshot$2<`); // 文案不变，仅修 href
  // 表格里如果有多条 Proof，可进一步将每行的 data-hash 绑定各自 id（可选）
  return out;
}

async function emitEvidencePage(pubRoot, id, sourceUrl) {
  const dir = path.join(pubRoot, "evidence", id);
  await fs.mkdir(dir, { recursive: true });
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snapshot ${id}</title>
<style>
body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica Neue,Arial;padding:24px}
header{margin-bottom:16px}
img{max-width:100%;height:auto;border:1px solid #eee;border-radius:8px}
.meta{color:#666;font-size:14px;margin:8px 0 16px}
a{color:#0b66ff;text-decoration:none}
</style>
</head><body>
<header><h1>Snapshot</h1></header>
<div class="meta">ID: ${id}${sourceUrl ? ` · Source: <a href="${sourceUrl}" target="_blank" rel="noopener">${sourceUrl}</a>`: ''}</div>
<figure><img src="/assets/snapshots/${id}.webp" alt="snapshot ${id}"/></figure>
</body></html>`;
  await fs.writeFile(path.join(dir, "index.html"), html, "utf8");
}

async function ensureSnapshotAsset(pubRoot, id) {
  const p = path.join(pubRoot, "assets", "snapshots", `${id}.webp`);
  await fs.mkdir(path.dirname(p), { recursive: true });
  try { await fs.access(p); return; } catch {}
  await fs.writeFile(p, Buffer.from(WEBP_1x1_BASE64, "base64")); // 占位
}

async function main() {
  const pubRoot = await pickOutputRoot();
  const reportRoots = ["reports"]; // 只处理报告目录
  const htmlFiles = [];

  for (const rr of reportRoots) {
    const dir = path.join(pubRoot, rr);
    try {
      const st = await fs.stat(dir);
      if (st.isDirectory()) htmlFiles.push(...await globHtml(dir));
    } catch {}
  }

  if (!htmlFiles.length) {
    console.log("[postbuild] no report html found under", reportRoots.map(r=>path.join(pubRoot,r)).join(", "));
    return;
  }

  const globalIds = new Set();

  for (const file of htmlFiles) {
    let html = await fs.readFile(file, "utf8");
    const ids = extractSnapshotIds(html);
    if (ids.length) {
      ids.forEach(x => globalIds.add(x));
      const rewritten = rewriteSnapshotLinks(html, ids);
      if (rewritten !== html) {
        await fs.writeFile(file, rewritten, "utf8");
        console.log("[fix] rewrite", path.relative(pubRoot, file), "-> /evidence/", ids[0]);
      }
    }
  }

  // 产出证据页 + 占位图
  for (const id of globalIds) {
    await emitEvidencePage(pubRoot, id);
    await ensureSnapshotAsset(pubRoot, id);
  }

  console.log(`[postbuild] evidence pages emitted: ${globalIds.size}, build root: ${pubRoot}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
