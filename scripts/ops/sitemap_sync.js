#!/usr/bin/env node
// CJS版：确保 public/seo/sitemap.xml 存在（从 public/sitemap.xml 同步过去）
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const src = path.join(root, 'public', 'sitemap.xml');
const dst = path.join(root, 'public', 'seo', 'sitemap.xml');
try {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(src)) {
    fs.writeFileSync(dst, fs.readFileSync(src));
    console.log('sitemap_sync: ensured public/seo/sitemap.xml exists');
  } else {
    console.warn('sitemap_sync: source missing, skipped');
  }
} catch (e) {
  console.warn('sitemap_sync: warning:', e.message);
}
