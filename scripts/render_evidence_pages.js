
/**
 * Render very simple static HTML pages for evidence.
 * - For each evidence/vendor/key, create a static index.html
 * - Create /public/evidence/index.html with links
 */
import fs from "fs/promises";
import path from "path";

function htmlPage(title, body) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="canonical" href="/evidence/">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
</head><body>
<header><a href="/">CG Alert</a> · <a href="/reports/">Reports</a> · <a href="/pricing/">Pricing</a> · <a href="/evidence/">Evidence</a></header>
<main>${body}</main>
<footer><small>© CG Alert</small></footer>
</body></html>`;
}

async function readJson(p) { return JSON.parse(await fs.readFile(p,"utf-8")); }
async function ensureDir(d){ await fs.mkdir(d, { recursive:true }); }
async function fileExists(p){ try{ await fs.stat(p); return true;}catch{ return false; } }

function toLinkLabel(item){
  const when = (item.confirmed_at || item.first_seen_at || "").slice(0,19).replace("T"," ");
  return `${item.vendor} · ${item.page} · ${when}`;
}

async function listEvidenceJson() {
  const out = [];
  async function walk(base){
    const entries = await fs.readdir(base, { withFileTypes:true });
    for (const e of entries) {
      const p = path.join(base, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      if (p.endsWith(".json") && !p.includes(path.sep + ".pending" + path.sep) && !p.includes(path.sep + ".confirmed" + path.sep) && !p.endsWith("_last_poll.json")) {
        out.push(p);
      }
    }
  }
  try { await walk("evidence"); } catch {}
  return out.sort();
}

async function main() {
  const files = await listEvidenceJson();
  const pub = path.join("public","evidence");
  await ensureDir(pub);
  const links = [];

  for (const f of files) {
    const item = await readJson(f);
    const rel = f.split(path.sep).slice(1); // drop 'evidence'
    const vendor = rel[0], key = rel[1];
    const ts = path.basename(f).replace(/\.json$/,"");
    const outDir = path.join(pub, vendor, key);
    await ensureDir(outDir);
    const body = `<h1>${vendor} · ${item.page}</h1>
<p><strong>URL:</strong> <a href="${item.url}" rel="noopener">${item.url}</a></p>
<p><strong>Confirmed at:</strong> ${item.confirmed_at || ""}</p>
${item.new_hash ? `<p><strong>Content hash (SHA-256):</strong> <code>${item.new_hash}</code></p>` : ""}
${item.status_code ? `<p><strong>HTTP status:</strong> ${item.status_code}</p>` : ""}
<p class="evidence-note">Hashes are computed from the raw HTTP response body at capture time. Any tampering would change the hash.</p>
<pre>${(item.snippet||"").replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>`;
    await fs.writeFile(path.join(outDir,"index.html"), htmlPage(`${vendor} – ${item.page}`, body), "utf-8");

    const href = `/evidence/${vendor}/${key}/`;
    links.push(`<li><a href="${href}">${toLinkLabel(item)}</a></li>`);
  }

  const listHtml = `<h1>Evidence</h1><ul>${links.join("\n")}</ul>`;
  await fs.writeFile(path.join(pub,"index.html"), htmlPage("Evidence", listHtml), "utf-8");
}
await main();
