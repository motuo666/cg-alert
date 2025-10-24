#!/usr/bin/env node
/**
 * Theme Injector (dedupe edition)
 * - Ensures single app header by REMOVING any existing <header> blocks first
 * - Ensures /assets/cg-theme.css in <head>
 * - Idempotent
 */
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();
const TARGET_DIRS = ['.', 'public', 'reports', 'who-uses', 'seo', 'evidence'];
const EXCLUDE = new Set(['node_modules','.git','.github','.next','.vercel','.vscode']);
const EXT = /\.html?$/i;

function* walk(dir){ const st=fs.statSync(dir); if(!st.isDirectory()) return;
  let ents=[]; try{ ents = fs.readdirSync(dir,{withFileTypes:true}); } catch { return; }
  for(const e of ents){
    if(e.isDirectory()){
      if(EXCLUDE.has(e.name)) continue;
      yield* walk(path.join(dir,e.name));
    } else if (e.isFile() && EXT.test(e.name)){
      yield path.join(dir,e.name);
    }
  }
}

function has(s, re){ return new RegExp(re,'i').test(s); }

function stripHeaders(html){
  return html.replace(/<header\b[^>]*>[\s\S]*?<\/header>/ig, '');
}
function ensureCgCss(html){
  let s = html;
  if (!has(s, '<link[^>]+cg-theme\\.css')){
    s = s.replace(/<\/head>/i, '\n<link rel="stylesheet" href="/assets/cg-theme.css">\n</head>');
  }
  return s;
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

function injectHeader(html){
  if (!/<body/i.test(html)) return html;
  return html.replace(/<body[^>]*>/i, m => m + HEADER);
}

function processFile(fp){
  let s = fs.readFileSync(fp,'utf8');
  const before = s;
  s = stripHeaders(s);         // remove any page-local headers first
  s = ensureCgCss(s);          // ensure theme css present
  s = injectHeader(s);         // inject our header
  if (s !== before){ fs.writeFileSync(fp,s,'utf8'); return true; }
  return false;
}

let scanned=0, changed=0;
for (const base of TARGET_DIRS){
  const abs = path.join(ROOT, base);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)){ scanned++; if (processFile(file)) changed++; }
}
console.log(`theme_injector (dedupe): scanned=${scanned} changed=${changed}`);
