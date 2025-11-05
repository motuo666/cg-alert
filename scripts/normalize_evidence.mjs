// Enhanced normalize_evidence.mjs (1159)
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const repoRoot = process.cwd();
const pubRoot = path.join(repoRoot, 'public');
const evidenceRoot = path.join(pubRoot, 'evidence');
const assetsDir = path.join(evidenceRoot, 'assets');
const FALLBACK_HREF = '/evidence/_common/fallback.css';

function isHtml(p) { return p.toLowerCase().endsWith('.html'); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function extFromUrl(u, fallback='bin'){ const m = u.toLowerCase().match(/\.([a-z0-9]{1,8})(?:[?#]|$)/); return m ? m[1] : fallback; }

async function ensureDir(d) { await fs.mkdir(d, { recursive: true }); }

async function walk(dir) {
  const out = [];
  let ents;
  try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

function injectFallback(html) {
  if (html.includes(FALLBACK_HREF)) return html;
  const link = `<link rel="stylesheet" href="${FALLBACK_HREF}" />`;
  return html.includes('</head>') ? html.replace('</head>', `  ${link}\n</head>`) : `${link}\n${html}`;
}

function vendorHostFromPath(absFile) {
  const parts = absFile.split(path.sep);
  const idx = parts.lastIndexOf('evidence');
  if (idx >= 0 && parts.length > idx+1) return parts[idx+1];
  return null;
}

function extractSourceUrl(html) {
  const metas = [
    /<meta[^>]+name=["']original-url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    /data-source-url=["']([^"']+)["']/i,
    /Captured from:\s*(https?:[^\s"'>]+)/i,
  ];
  for (const re of metas) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

function absolutize(href, baseUrl) {
  try { return new URL(href, baseUrl).toString(); } catch { return null; }
}

function isHttpUrl(u) { return /^https?:\/\//i.test(u); }
function isExternal(href) { return /^(https?:|data:|mailto:|tel:)/i.test(href) || href.startsWith('#') || href === ''; }

function extractRefs(html) {
  const refs = [];
  const reHref = /<(link|a)\b[^>]*?href=["']([^"']+)["'][^>]*>/ig;
  const reSrc  = /<(script|img|source)\b[^>]*?src=["']([^"']+)["'][^>]*>/ig;
  let m;
  while ((m = reHref.exec(html))) refs.push({ tag:m[1], attr:'href', val:m[2] });
  while ((m = reSrc.exec(html)))  refs.push({ tag:m[1], attr:'src',  val:m[2] });
  return refs;
}

async function fetchBuffer(u) {
  const res = await fetch(u, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function main() {
  await ensureDir(assetsDir);

  const files = (await walk(evidenceRoot)).filter(p => isHtml(p) && /index.*\.html$/.test(path.basename(p)));
  let scanned = 0, localized = 0, injected = 0, errors = 0;

  for (const abs of files) {
    scanned++;
    let html;
    try { html = await fs.readFile(abs, 'utf8'); } catch { errors++; continue; }

    const srcUrl = extractSourceUrl(html);
    const vendorHost = vendorHostFromPath(abs);
    const base = srcUrl ? srcUrl : (vendorHost ? `https://${vendorHost}/` : null);
    let changed = false;

    if (!html.includes(FALLBACK_HREF)) {
      html = injectFallback(html);
      injected++;
      changed = true;
    }

    const refs = extractRefs(html);
    for (const r of refs) {
      const href = r.val.trim();
      if (isExternal(href)) continue;
      if (!base) continue;

      const remote = absolutize(href, base);
      if (!remote || !isHttpUrl(remote)) continue;

      try {
        const buf = await fetchBuffer(remote);
        const ext = extFromUrl(remote, 'bin');
        const name = sha256(buf) + '.' + ext;
        const rel = path.join('evidence', 'assets', name);
        const out = path.join(pubRoot, rel);
        await fs.writeFile(out, buf);
        const localUrl = '/' + rel.replace(/\\/g,'/');
        const pattern = new RegExp(`${r.attr}=["']\s*${href.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\s*["']`, 'g');
        html = html.replace(pattern, `${r.attr}="${localUrl}"`);
        localized++;
        changed = true;
      } catch (e) {
        // ignore fetch failures
      }
    }

    if (changed) {
      await fs.writeFile(abs, html, 'utf8');
    }
  }

  console.log(JSON.stringify({ scanned, injected, localized, errors, assetsDir }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
