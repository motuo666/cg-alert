#!/usr/bin/env node
// nav_inject.js — 给页面页脚自动加上 Channel 入口（幂等）
// 策略：优先在 </footer> 前插入一个 A 标签；若已存在则跳过。
// 处理 index.html、updates/index.html、vendors/*/index.html（过滤 _* 与 acme）。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const targets = [];

// 主页
const home = path.join(ROOT, 'index.html');
if (fs.existsSync(home)) targets.push(home);

// updates
const updates = path.join(ROOT, 'updates', 'index.html');
if (fs.existsSync(updates)) targets.push(updates);

// vendors/*
const vendorsDir = path.join(ROOT, 'vendors');
if (fs.existsSync(vendorsDir)) {
  for (const d of fs.readdirSync(vendorsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const slug = d.name;
    if (!slug || slug === 'acme' || slug.startsWith('_')) continue;
    const fp = path.join(vendorsDir, slug, 'index.html');
    if (fs.existsSync(fp)) targets.push(fp);
  }
}

const snippet = `<a data-cg-nav="1" href="/channel/">Channel</a>`;

function inject(file) {
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('data-cg-nav="1"') || html.includes('href="/channel/"')) {
    console.log(`skip (exists): ${rel(file)}`);
    return;
  }
  if (/<\/footer>/i.test(html)) {
    html = html.replace(/<\/footer>/i, `${snippet}\n</footer>`);
    fs.writeFileSync(file, html, 'utf8');
    console.log(`injected (footer): ${rel(file)}`);
    return;
  }
  // 若没有 footer，就不强插，避免破坏布局
  console.log(`no footer, skip: ${rel(file)}`);
}

function rel(p){ return path.relative(ROOT, p); }

for (const f of targets) inject(f);
