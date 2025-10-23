
// scripts/build_diff_visuals.js
const fs = require('fs');
const path = require('path');
const { diffLines, renderHtml } = require('./diff_engine');

const EVID_ROOT = process.env.EVIDENCE_ROOT || path.join(process.cwd(), 'public', 'evidence');
const MAX_BYTES = parseInt(process.env.DIFF_MAX_BYTES || '1500000', 10); // 1.5 MB per snapshot cap

function exists(p){ try{ fs.accessSync(p); return true; } catch { return false; } }
function readText(p){ try{ return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function stripHtml(html){
  return html.replace(/<script[\s\S]*?<\/script>/gi,'')
             .replace(/<style[\s\S]*?<\/style>/gi,'')
             .replace(/<[^>]+>/g,' ')
             .replace(/\s+/g,' ')
             .trim();
}
function readEvidenceText(dir){
  const cand = ['content.txt','raw.txt','snapshot.txt','body.txt','index.txt'];
  for (const f of cand) {
    const p = path.join(dir, f);
    if (exists(p)) {
      let s = readText(p);
      if (s.length > MAX_BYTES) s = s.slice(0, MAX_BYTES);
      return s;
    }
  }
  const ih = path.join(dir,'index.html');
  if (exists(ih)) {
    let s = stripHtml(readText(ih));
    if (s.length > MAX_BYTES) s = s.slice(0, MAX_BYTES);
    return s;
  }
  return '';
}
function readMeta(dir){
  const cand = ['meta.json','proof.json','index.json'];
  for (const f of cand) {
    const p = path.join(dir, f);
    if (exists(p)) {
      try { return JSON.parse(readText(p)); } catch {}
    }
  }
  const ih = path.join(dir,'index.html');
  if (exists(ih)) {
    const html = readText(ih);
    const m = html.match(/https?:\/\/[^\s"'<>]+/);
    if (m) return { url: m[0] };
  }
  return {};
}
function mtimeOrNow(p){ try { return fs.statSync(p).mtimeMs; } catch { return Date.now(); } }
function findEvidenceDirs(root){
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
        const ih = path.join(ap, 'index.html');
        if (exists(ih)) { out.push(ap); continue; }
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

function buildCatalog(dirs){
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

function writeDiff(curr, prev){
  const ops = diffLines(prev.text, curr.text);
  const { html, stats } = renderHtml(ops);
  const htmlOut = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
  <header>
    <div>
      <h2 style="margin:0">Content Diff</h2>
      <div class="meta">${new Date(curr.ts).toISOString()} vs ${new Date(prev.ts).toISOString()}</div>
      <div class="meta"><a href="${curr.url}" target="_blank" rel="noopener">${curr.url}</a></div>
    </div>
    <div><a class="btn" href="./index.html">← Back to Evidence</a></div>
  </header>
  ${html}
  </body></html>`;
  fs.writeFileSync(path.join(curr.dir, 'diff.html'), htmlOut, 'utf8');
  fs.writeFileSync(path.join(curr.dir, 'diff.json'), JSON.stringify(stats, null, 2), 'utf8');
}

function main(){
  const dirs = findEvidenceDirs(EVID_ROOT);
  if (!dirs.length) { console.log('No evidence dirs found'); return; }
  const catalog = buildCatalog(dirs);
  let built=0, skipped=0;
  for (const arr of catalog.values()) {
    for (let i=1;i<arr.length;i++) {
      const prev = arr[i-1], curr = arr[i];
      const out = path.join(curr.dir, 'diff.html');
      if (fs.existsSync(out)) { skipped++; continue; }
      try {
        if (prev.text && curr.text && prev.text !== curr.text) {
          writeDiff(curr, prev);
          built++;
        } else skipped++;
      } catch (e) {
        console.error('Diff failed for', curr.dir, e);
        skipped++;
      }
    }
  }
  console.log(`Diff Visualizer SAFE: built=${built} skipped=${skipped}`);
}

if (require.main === module) main();
