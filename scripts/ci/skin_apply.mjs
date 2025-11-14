// scripts/ci/skin_apply.mjs
// Ensure every HTML page loads site CSS and includes header/footer HTML.
// Usage: node scripts/ci/skin_apply.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..', '..');
const headerPath = path.join(repoRoot, 'includes', 'header.html');
const footerPath = path.join(repoRoot, 'includes', 'footer.html');

const headerHTML = fs.existsSync(headerPath) ? fs.readFileSync(headerPath, 'utf8') : '';
const footerHTML = fs.existsSync(footerPath) ? fs.readFileSync(footerPath, 'utf8') : '';

if (!headerHTML) console.warn('[skin_apply] WARN: includes/header.html not found or empty; header injection will be skipped.');
if (!footerHTML) console.warn('[skin_apply] WARN: includes/footer.html not found or empty; footer injection will be skipped.');

const CSS_SNIPPETS = [
  // keep existing bundle names if present in repo
  `<link rel="preload" href="/assets/home-v3c.css" as="style">`,
  `<link rel="stylesheet" href="/assets/home-v3c.css">`,
  `<link rel="stylesheet" href="/assets/home-overrides.css">`,
  // a resilient baseline so pages never look unstyled even if above files move:
  `<link rel="stylesheet" href="/assets/critical.css">`
];

const HEAD_MARK = '</head>';
const BODY_OPEN_RE = /<body[^>]*>/i;

function shouldSkip(p){
  const rel = path.relative(repoRoot, p);
  if (rel.startsWith('assets/')) return true;
  if (rel.startsWith('includes/')) return true;
  if (rel.startsWith('.git/')) return true;
  if (rel.startsWith('.github/')) return true;
  if (rel.includes('/node_modules/')) return true;
  if (rel.startsWith('workers/')) return true;
  if (rel.startsWith('lead-gateway/')) return true;
  return false;
}

function walk(dir, out=[]){
  for (const ent of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!shouldSkip(p)) walk(p, out);
    } else {
      if (p.toLowerCase().endsWith('.html') && !shouldSkip(p)) out.push(p);
    }
  }
  return out;
}

function ensureHeadCss(html){
  const hasV3 = html.includes('home-v3c.css') || html.includes('home.css');
  const hasOverrides = html.includes('home-overrides.css');
  const hasCritical = html.includes('critical.css');
  if (hasV3 && hasOverrides && hasCritical) return html; // looks good

  let inject = '';
  for (const tag of CSS_SNIPPETS){
    if (!html.includes(tag.split('href="')[1]?.split('"')[0] || '___nope___')) {
      inject += '  ' + tag + '\n';
    }
  }

  if (!inject) return html;
  if (html.includes(HEAD_MARK)) {
    return html.replace(HEAD_MARK, `  <!-- auto-injected by skin_apply.mjs -->\n${inject}${HEAD_MARK}`);
  } else if (html.includes('<head>')) {
    return html.replace('<head>', `<head>\n  <!-- auto-injected by skin_apply.mjs -->\n${inject}`);
  } else {
    // worst case: synthesize a head
    return `<!doctype html>\n<html>\n<head>\n${inject}</head>\n` + html;
  }
}

function ensureHeader(html){
  if (!headerHTML) return html;
  if (html.includes('includes/header.html') || html.toLowerCase().includes('<header')) {
    // assume has header
    return html;
  }
  const m = html.match(BODY_OPEN_RE);
  if (!m) return html;
  const idx = m.index + m[0].length;
  return html.slice(0, idx) + `\n<!-- injected header -->\n${headerHTML}\n` + html.slice(idx);
}

function ensureFooter(html){
  if (!footerHTML) return html;
  if (html.includes('includes/footer.html') || html.toLowerCase().includes('<footer')) {
    return html;
  }
  const closeIdx = html.toLowerCase().lastIndexOf('</body>');
  if (closeIdx === -1) return html + `\n${footerHTML}\n`;
  return html.slice(0, closeIdx) + `\n<!-- injected footer -->\n${footerHTML}\n` + html.slice(closeIdx);
}

const targets = walk(repoRoot, []);
let changed = 0;
for (const f of targets){
  let html = fs.readFileSync(f, 'utf8');
  const orig = html;
  html = ensureHeadCss(html);
  html = ensureHeader(html);
  html = ensureFooter(html);
  if (html !== orig){
    fs.writeFileSync(f, html, 'utf8');
    changed++;
    console.log('[skin_apply] patched', path.relative(repoRoot, f));
  }
}

console.log(`[skin_apply] completed. Patched ${changed} file(s).`);
