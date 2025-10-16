#!/usr/bin/env node
/**
 * build_who_uses.js
 * 从 Subprocessors 类型证据构建反查索引：
 * - public/who-uses/index.html
 * - public/who-uses/<processor>/index.html  列出采用该处理方的 vendors
 *
 * 解析策略（尽量通用）：
 * - 优先 j.subprocessors / j.data 数组中的 name/vendor 字段
 * - 其次尝试在 j.content / j.text 中用简单正则提取一列候选名（逗号/换行分隔，剔除明显无关）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVD = path.join(ROOT, 'evidence');
const OUT = path.join(ROOT, 'public', 'who-uses');
const TPL = path.join(OUT, '_template.html');

function walkJSON(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJSON(p, acc);
    else if (ent.isFile() && ent.name.endsWith('.json')) acc.push(p);
  }
  return acc;
}

function slugify(s){
  return String(s||'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,64);
}

function extractProcessors(j){
  const out = new Set();

  const arr = Array.isArray(j.subprocessors)? j.subprocessors
            : Array.isArray(j.data)? j.data
            : Array.isArray(j.items)? j.items
            : null;

  if (arr) {
    for (const it of arr) {
      const name = (it && (it.name || it.processor || it.vendor || it.provider)) || '';
      if (name && name.length > 1) out.add(name.trim());
    }
  }

  if (out.size === 0) {
    const blob = j.content || j.text || '';
    if (blob) {
      // 简单行分割 + 过滤掉 URL/邮箱/过短词
      const parts = String(blob).split(/[\n,;]+/).map(s=>s.trim());
      for (const p of parts){
        if (p.length < 2) continue;
        if (/\w+@\w+/.test(p)) continue;
        if (/https?:\/\//i.test(p)) continue;
        // 常见噪音过滤
        if (/^(version|last\s*updated|date|policy)/i.test(p)) continue;
        out.add(p);
      }
    }
  }

  return Array.from(out);
}

function renderIndex(list){
  const items = list.map(p => `<li><a href="./${p.slug}/">${p.name}</a> <small>(${p.count})</small></li>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Who Uses — Index</title>
<style>body{font-family:system-ui,Arial;max-width:800px;margin:auto;padding:24px} li{margin:6px 0}</style></head>
<body>
<h1>Who Uses — Subprocessors</h1>
<ol>
${items}
</ol>
</body></html>`;
}

function renderProcessor(name, slug, vendors){
  const items = vendors.map(v => `<li><a href="/vendors/${v}/">${v}</a></li>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Who Uses ${name}</title>
<style>body{font-family:system-ui,Arial;max-width:800px;margin:auto;padding:24px} li{margin:6px 0}</style></head>
<body>
<h1>Who Uses: ${name}</h1>
<ol>
${items}
</ol>
<p><a href="/who-uses/">Back to index</a></p>
</body></html>`;
}

function run(){
  fs.mkdirSync(OUT, { recursive: true });

  const files = walkJSON(EVD);
  const map = new Map(); // processor_slug -> { name, vendors:Set }

  for (const fp of files){
    try{
      const j = JSON.parse(fs.readFileSync(fp,'utf8'));
      const type = String(j.type || j.category || '').toLowerCase();
      if (!/subprocessor/.test(type)) continue;

      const vendor = fp.split(path.sep)[fp.split(path.sep).indexOf('evidence')+1] || '';
      if (!vendor) continue;

      const names = extractProcessors(j);
      for (const nm of names){
        const slug = slugify(nm);
        if (!slug) continue;
        if (!map.has(slug)) map.set(slug, { name: nm, vendors: new Set() });
        map.get(slug).vendors.add(vendor);
      }
    }catch(e){}
  }

  // 写 index & 每个 processor 页
  const list = Array.from(map.entries())
    .map(([slug, obj]) => ({ slug, name: obj.name, count: obj.vendors.size }))
    .sort((a,b)=> b.count - a.count || a.slug.localeCompare(b.slug));

  fs.writeFileSync(path.join(OUT, 'index.html'), renderIndex(list), 'utf8');

  for (const [slug, obj] of map.entries()){
    const dir = path.join(OUT, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderProcessor(obj.name, slug, Array.from(obj.vendors).sort()), 'utf8');
  }

  console.log(`who-uses: processors=${list.length}`);
}

run();
