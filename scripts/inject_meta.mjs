// Inject OG/Twitter meta tags (1159)
import { promises as fs } from 'fs';
import path from 'path';

const pubRoot = path.join(process.cwd(), 'public');

function isHtml(p) { return p.toLowerCase().endsWith('.html'); }

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

function hasMeta(html, nameOrProp) {
  const re = new RegExp(`<meta[^>]+(name|property)=["']${nameOrProp}["'][^>]*>`, 'i');
  return re.test(html);
}

function injectMeta(html, title='CG Alert — Evidence-backed vendor change alerts', desc='Monitor vendor public pages and get verifiable evidence alerts.', url='/', image='/og.png') {
  const tags = [
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:image" content="${image}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${image}">`,
  ];
  let out = html;
  for (const t of tags) {
    const nameOrProp = t.includes('property="og:') ? t.match(/property="([^"]+)"/i)[1] : t.match(/name="([^"]+)"/i)[1];
    if (!hasMeta(out, nameOrProp)) {
      out = out.replace('</head>', `  ${t}\n</head>`);
    }
  }
  return out;
}

async function main() {
  let changed = 0, scanned = 0;
  const files = await walk(pubRoot);
  for (const f of files) {
    if (!isHtml(f)) continue;
    scanned++;
    let html; try { html = await fs.readFile(f, 'utf8'); } catch { continue; }
    if (!html.includes('</head>')) continue;
    const rel = '/' + f.replace(pubRoot + '/', '').replace(/\\/g, '/');
    const next = injectMeta(html, undefined, undefined, rel, '/og.png');
    if (next !== html) { await fs.writeFile(f, next, 'utf8'); changed++; }
  }
  console.log(JSON.stringify({ scanned, changed }));
}

main().catch(e => { console.error(e); process.exit(1); });
