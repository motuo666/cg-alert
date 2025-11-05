// LCP preload injector
import { promises as fs } from 'fs';
import path from 'path';

const pubRoot = path.join(process.cwd(), 'public');

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

function isHtml(p){ return p.toLowerCase().endsWith('.html'); }

function firstHref(html, tag) {
  const re = tag === 'css'
    ? /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/i
    : /<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/i;
  const m = html.match(re);
  return m ? m[1] : null;
}

function injectPreload(html, href, asType) {
  if (!href) return html;
  const exists = new RegExp(`<link[^>]+rel=["']preload["'][^>]+href=["']${href.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}["']`, 'i').test(html);
  if (exists) return html;
  const tag = `<link rel="preload" href="${href}" as="${asType}">`;
  return html.includes('</head>') ? html.replace('</head>', `  ${tag}\n</head>`) : html;
}

async function main() {
  const files = (await walk(pubRoot)).filter(isHtml);
  let changed = 0;
  for (const f of files) {
    let html; try { html = await fs.readFile(f, 'utf8'); } catch { continue; }
    const css = firstHref(html, 'css');
    const js  = firstHref(html, 'js');
    let next = injectPreload(html, css, 'style');
    next = injectPreload(next, js, 'script');
    if (next !== html) { await fs.writeFile(f, next, 'utf8'); changed++; }
  }
  console.log(JSON.stringify({ changed }));
}

main().catch(e => { console.error(e); process.exit(1); });
