// STRICT link checker
import { promises as fs } from 'fs';
import path from 'path';

const STRICT = (process.env.STRICT ?? 'true').toLowerCase() === 'true';
const pubRoot = path.join(process.cwd(), 'public');

function isHtml(p) { return p.toLowerCase().endsWith('.html'); }
function isExternal(href) {
  return /^(https?:|mailto:|tel:|data:)/i.test(href) || href === '' || href.startsWith('#');
}

async function walk(dir) {
  const out = [];
  const ents = await fs.readdir(dir, { withFileTypes: true });
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

function extractHrefs(html) {
  const out = [];
  const re = /href\s*=\s*["']([^"']+)["']/ig;
  let m; while ((m = re.exec(html))) out.push(m[1].trim());
  return out;
}

function resolveTarget(fromAbs, href) {
  const fromDir = path.dirname(fromAbs);
  let target = href.startsWith('/') ? path.join(pubRoot, href) : path.join(fromDir, href);
  return target;
}

function resolveHtmlCandidate(target) {
  return [target, path.join(target, 'index.html'), target.endsWith('.html') ? null : target + '.html']
    .filter(Boolean);
}

async function existsAny(paths) {
  for (const p of paths) {
    try { await fs.access(p); return true; } catch {}
  }
  return false;
}

async function main() {
  const files = await walk(pubRoot);
  const htmlFiles = files.filter(isHtml);
  let total = 0, broken = 0;
  const brokenList = [];

  for (const f of htmlFiles) {
    const rel = path.relative(pubRoot, f);
    const isEvidence = rel.startsWith('evidence/');
    let html; try { html = await fs.readFile(f, 'utf8'); } catch { continue; }
    const hrefs = extractHrefs(html);
    for (const href of hrefs) {
      if (isExternal(href)) continue;
      if (isEvidence && href.startsWith('/')) continue;
      total++;
      const target = resolveTarget(f, href);
      const candidates = resolveHtmlCandidate(target);
      const ok = await existsAny(candidates);
      if (!ok) {
        broken++;
        brokenList.push({ from: rel, href });
      }
    }
  }

  const summary = { total, broken, brokenRate: total ? broken/total : 0 };
  console.log('LINKCHECK_SUMMARY ' + JSON.stringify(summary));
  if (brokenList.length) {
    console.log('BROKEN_SAMPLE ' + JSON.stringify(brokenList.slice(0, 100)));
  }
  if (STRICT && broken > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(2); });
