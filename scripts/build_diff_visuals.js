const fs = require('fs');
const path = require('path');
const { diffToHtml } = require('./diff_lcs');

const ROOT = process.cwd();
const EVID_ROOT = path.join(ROOT, 'public', 'evidence');

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi,'')
             .replace(/<style[\s\S]*?<\/style>/gi,'')
             .replace(/<[^>]+>/g,' ')
             .replace(/\s+/g,' ')
             .trim();
}
function readMeta(dir) {
  const cand = ['meta.json','proof.json','index.json'];
  for (const f of cand) {
    const p = path.join(dir, f);
    if (exists(p)) { try { return JSON.parse(readText(p)); } catch {} }
  }
  const ih = path.join(dir,'index.html');
  if (exists(ih)) {
    const html = readText(ih);
    const m = html.match(/https?:\/\/[^\s"'<>]+/);
    if (m) return { url: m[0] };
  }
  return {};
}
function readEvidenceText(dir) {
  const cand = ['content.txt','raw.txt','snapshot.txt','body.txt','index.txt'];
  for (const f of cand) { const p = path.join(dir,f); if (exists(p)) return readText(p); }
  const ih = path.join(dir,'index.html');
  if (exists(ih)) return stripHtml(readText(ih));
  return '';
}
function mtimeOrNow(p) { try { return fs.statSync(p).mtimeMs; } catch { return Date.now(); } }
function findEvidenceDirs(root) {
  const out = [];
  if (!exists(root)) return out;
  const months = fs.readdirSync(root);
  for (const month of months) {
    const mp = path.join(root, month);
    if (!fs.statSync(mp).isDirectory()) continue;
    const domains = fs.readdirSync(mp);
    for (const dom of domains) {
      const dp = path.join(mp, dom);
      if (!fs.statSync(dp).isDirectory()) continue;
      const children = fs.readdirSync(dp);
      for (const a of children) {
        const ap = path.join(dp, a);
        if (!fs.statSync(ap).isDirectory()) continue;
        // either ap is hash leaf (has index.html) or path bucket containing hash leafs
        const ih = path.join(ap,'index.html');
        if (exists(ih)) { out.push(ap); continue; }
        // nested
        const kids = fs.readdirSync(ap);
        for (const k of kids) {
          const kp = path.join(ap, k);
          if (fs.statSync(kp).isDirectory() && exists(path.join(kp,'index.html'))) out.push(kp);
        }
      }
    }
  }
  return out;
}
function buildCatalog(dirs) {
  const byUrl = new Map();
  for (const d of dirs) {
    const meta = readMeta(d);
    const url = meta.url || meta.source_url || null;
    const ts = meta.timestamp ? Date.parse(meta.timestamp) : mtimeOrNow(path.join(d,'index.html'));
    const text = readEvidenceText(d);
    if (!url || !text) continue;
    const item = { dir: d, url, ts, text };
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(item);
  }
  for (const arr of byUrl.values()) arr.sort((a,b)=>a.ts-b.ts);
  return byUrl;
}
function writeDiff(curr, prev) {
  const { html, stats } = diffToHtml(prev.text, curr.text);
  const styles = `
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.55; padding: 16px; max-width: 1100px; margin: auto; }
    header { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap: wrap; }
    .meta { font-size: 12px; color: #666; }
    ins { background: #e6ffed; text-decoration: none; border-bottom: 1px solid #8de68d; }
    del { background: #ffeef0; text-decoration: line-through; }
    .box { background:#fafafa; border:1px solid #eee; border-radius:12px; padding:14px; }
    .stats { font-size: 13px; color:#555; }
    a { color: inherit; }
    .btn { padding:8px 12px; border:1px solid #ddd; border-radius:8px; text-decoration:none; }
  </style>`;
  const head = `<header>
    <div>
      <h2 style="margin:0">Content Diff</h2>
      <div class="meta">${new Date(curr.ts).toISOString()} vs ${new Date(prev.ts).toISOString()}</div>
      <div class="meta"><a href="${curr.url}" target="_blank" rel="noopener">${curr.url}</a></div>
    </div>
    <div><a class="btn" href="./index.html">← Back to Evidence</a></div>
  </header>`;
  const summary = `<div class="box stats">Insertions: ${stats.insertions} · Deletions: ${stats.deletions} · Unchanged tokens: ${stats.equals}</div>`;
  const body = `<div class="box" style="margin-top:12px">${html}</div>`;
  const htmlOut = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body>${head}${summary}${body}</body></html>`;
  fs.writeFileSync(path.join(curr.dir, 'diff.html'), htmlOut, 'utf8');
  fs.writeFileSync(path.join(curr.dir, 'diff.json'), JSON.stringify(stats, null, 2), 'utf8');
}
function main() {
  const dirs = findEvidenceDirs(EVID_ROOT);
  if (!dirs.length) { console.log('No evidence dirs found'); return; }
  const catalog = buildCatalog(dirs);
  let built = 0, skipped = 0;
  for (const arr of catalog.values()) {
    for (let i=1;i<arr.length;i++) {
      const prev = arr[i-1], curr = arr[i];
      const outPath = path.join(curr.dir, 'diff.html');
      if (exists(outPath)) { skipped++; continue; }
      if (prev.text && curr.text && prev.text !== curr.text) {
        writeDiff(curr, prev);
        built++;
      } else skipped++;
    }
  }
  console.log(`Diff Visualizer: built=${built} skipped=${skipped}`);
}
if (require.main === module) main();
