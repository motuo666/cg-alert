#!/usr/bin/env node
/**
 * Theme Injector — apply homepage look to all target pages.
 * Idempotent: running multiple times is safe.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGET_DIRS = ['.', 'public', 'reports', 'who-uses', 'seo', 'evidence']; // add more as needed
const EXCLUDE_DIRS = new Set(['node_modules','.git','.github','.next','.vercel','.vscode']);
const EXT = /\.html?$/i;

function* walk(dir) {
  const st = fs.statSync(dir);
  if (!st.isDirectory()) return;
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name)) yield* walk(p);
    } else if (EXT.test(e.name)) {
      yield p;
    }
  }
}

function has(str, pattern) { return new RegExp(pattern, 'i').test(str); }

function ensureHeadLink(html) {
  if (has(html, '<link[^>]+cg-theme\\.css')) return html;
  if (!has(html, '</head>')) return html;
  const link = '\n<link rel="stylesheet" href="/assets/cg-theme.css">';
  return html.replace(/<\/head>/i, link + '\n</head>');
}

function ensureThemeColor(html) {
  if (has(html, 'name=[\'"]theme-color[\'"]')) return html;
  if (!has(html, '</head>')) return html;
  const meta = '\n<meta name="theme-color" content="#0b0">';
  return html.replace(/<\/head>/i, meta + '\n</head>');
}

const HEADER = `
<header class="app-header">
  <div class="nav container">
    <a class="logo" href="/"><img src="/icon.svg" alt="CG Alert">CG Alert</a>
    <a href="/reports/">Reports</a>
    <a href="/who-uses/">Who Uses</a>
    <a href="/rss.xml" rel="nofollow">RSS</a>
  </div>
</header>`;

const FOOTER = `
<footer class="container">© CG Alert — Evidence-backed vendor change alerts.</footer>`;

function ensureHeader(html) {
  if (has(html, 'class=[\'"]app-header[\'"]')) return html;
  if (!has(html, '<body')) return html;
  return html.replace(/<body[^>]*>/i, m => m + HEADER);
}

function ensureFooter(html) {
  if (has(html, '<footer[^>]*>')) return html;
  if (!has(html, '</body>')) return html;
  return html.replace(/<\/body>/i, FOOTER + '\n</body>');
}

function ensureMainClasses(html) {
  // Add "main container" to <main> if missing
  if (!has(html, '<main')) return html;
  return html.replace(/<main([^>]*)>/i, (m, attrs) => {
    const hasClass = /class\s*=\s*["'][^"']*["']/i.test(attrs);
    if (hasClass) {
      // append classes if not present
      return m.replace(/class\s*=\s*["']([^"']*)["']/i, (mm, cls) => {
        const set = new Set(cls.split(/\s+/).filter(Boolean));
        set.add('main'); set.add('container');
        return `class="${Array.from(set).join(' ')}"`;
      });
    } else {
      return `<main class="main container"${attrs}>`;
    }
  });
}

function processFile(fp) {
  const src = fs.readFileSync(fp, 'utf8');
  let out = src;
  out = ensureHeadLink(out);
  out = ensureThemeColor(out);
  out = ensureHeader(out);
  out = ensureFooter(out);
  out = ensureMainClasses(out);
  if (out !== src) {
    // backup once
    const bak = fp + '.bak';
    if (!fs.existsSync(bak)) fs.writeFileSync(bak, src, 'utf8');
    fs.writeFileSync(fp, out, 'utf8');
    return true;
  }
  return false;
}

let changed = 0, scanned = 0;
for (const base of TARGET_DIRS) {
  const abs = path.join(ROOT, base);
  if (!fs.existsSync(abs)) continue;
  for (const fp of walk(abs)) {
    scanned++;
    // skip our SEO landing if any user wants to keep minimal
    changed += processFile(fp) ? 1 : 0;
  }
}
console.log(`theme_injector: scanned=${scanned} changed=${changed}`);
process.exit(0);
