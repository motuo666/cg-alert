#!/usr/bin/env node
// scripts/seo/inject_meta.js
// Ensure <link rel="canonical"> and <meta name="description"> on all HTML (excluding public/evidence/*).
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(html?)$/i.test(e.name)) out.push(p);
  }
  return out;
}

function relPath(p) {
  return p.replace(ROOT + path.sep, '').replace(/\\/g, '/');
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstText(html) {
  const mP = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (mP && stripTags(mP[1]).length >= 40) return stripTags(mP[1]).slice(0, 200);
  const mH1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (mH1) return stripTags(mH1[1]).slice(0, 200);
  const mTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (mTitle) return stripTags(mTitle[1]).slice(0, 200);
  return 'Evidence-backed vendor change alerts with verifiable proofs.';
}

function ensureMeta(file) {
  if (file.includes('public/evidence/')) return false;
  let html = fs.readFileSync(file, 'utf8');
  const rel = '/' + relPath(file);
  const canonicalHref = ORIGIN.replace(/\/+$/,'') + rel.replace(/index\.html$/,'').replace(/\/$/, '') + (rel.endsWith('index.html') ? '/' : '');

  let changed = false;

  if (!/<link\s+[^>]*rel=["']canonical["'][^>]*>/i.test(html)) {
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m)=> m + `\n<link rel="canonical" href="${canonicalHref}">`);
      changed = true;
    }
  }

  if (!/<meta\s+[^>]*name=["']description["'][^>]*>/i.test(html)) {
    const desc = firstText(html);
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m)=> m + `\n<meta name="description" content="${desc}">`);
      changed = true;
    }
  }

  if (changed) fs.writeFileSync(file, html);
  return changed;
}

const files = walk(ROOT);
let count = 0;
for (const f of files) {
  if (ensureMeta(f)) count++;
}
console.log("meta_inject: files changed =", count);
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/meta_inject.txt', String(count));
