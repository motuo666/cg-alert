// style-unify-smart.mjs
// - Determine canonical CSS from repo root index.html (or most common CSS across repo)
// - Ensure those CSS files exist under public/ (copy from repo root if needed)
// - Inject into all public pages missing them (root-absolute hrefs)

import { promises as fs } from 'fs';
import path from 'path';

const repoRoot = process.cwd();
const pubRoot = path.join(repoRoot, 'public');
const canonical = ["/assets/home-v3c.css"];

function isHtml(p){ return p.toLowerCase().endsWith('.html'); }
async function walk(dir){ const out=[]; const ents=await fs.readdir(dir,{withFileTypes:true}); for (const e of ents){ const p=path.join(dir,e.name); if(e.isDirectory()) out.push(...await walk(p)); else out.push(p); } return out; }
function extractCss(html){ const out=[]; const re=/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/ig; let m; while((m=re.exec(html))) out.push(m[1].trim()); return out; }
function normalizeHref(href){ return href.split('#')[0].split('?')[0]; }

async function ensureCanonicalFiles() {
  for (const hrefRaw of canonical) {
    const href = normalizeHref(hrefRaw);
    if (!href || /^https?:/.test(href) || href.startsWith('data:')) continue;
    const dest = path.join(pubRoot, href.replace(/^\//,''));
    try { await fs.access(dest); continue; } catch {}
    // try copy from repo root (non-public) same path
    const src = path.join(repoRoot, href.replace(/^\//,''));
    try { await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.copyFile(src, dest); console.log('copied', src, '->', dest); } catch (e) {
      console.warn('skip missing canonical css', href);
    }
  }
}

function toRootAbsolute(fromFile, href){
  if (/^(https?:|data:|mailto:|tel:)/i.test(href) || href==='' || href.startsWith('#')) return href;
  if (href.startsWith('/')) return href;
  const rel=path.relative(pubRoot, path.join(path.dirname(fromFile), href)).replace(/\\/g,'/');
  return '/' + rel;
}

async function unify() {
  const indexPath = path.join(pubRoot, 'index.html');
  const files=(await walk(pubRoot)).filter(isHtml);
  let injectedPages=0;
  for (const f of files) {
    let html; try { html = await fs.readFile(f, 'utf8'); } catch { continue; }
    const pageCss = new Set(extractCss(html).map(normalizeHref));
    const need = canonical.filter(h => !pageCss.has(normalizeHref(h)) && !pageCss.has(normalizeHref(h).replace(/^\//,'')));
    if (need.length) {
      const links = need.map(h => `  <link rel="stylesheet" href="${toRootAbsolute(f, h)}">`).join('\n');
      if (html.includes('</head>')) html = html.replace('</head>', links + '\n</head>');
      else html = links + '\n' + html;
      await fs.writeFile(f, html, 'utf8');
      injectedPages++;
    }
  }
  console.log(JSON.stringify({ pages: files.length, injectedPages }));
}

async function main(){
  if (canonical.length === 0) { console.error('No canonical CSS detected'); return; }
  await ensureCanonicalFiles();
  await unify();
}

main().catch(e => { console.error(e); process.exit(1); });
