\
#!/usr/bin/env node
/**
 * scripts/repair_pages.js
 *
 * 目的：
 *   1. 扫描 vendors/, updates/, reports/, categories/, who-uses/ 下所有 .html
 *   2. 把坏掉的 <head$1 ...> 统一修成 <head>
 *   3. 把站内插进来的占位符 '...' 从 <head> / <meta> / <script> / <link> 里清理掉
 *   4. 保证每个文件开头有 <!doctype html>
 *
 * 用法（本地或 GitHub Actions 都可以）:
 *   node scripts/repair_pages.js
 *
 * 运行后会直接覆盖原文件（就地修复）。如有修改，会在 stdout 打印文件名。
 *
 * 这是 P0 稳定化的一部分：修掉脏 HTML，避免页面 meta / CTA / OG 卡片
 * 看起来像半成品，从而影响购买信心。
 */

const fs = require("fs");
const path = require("path");

// 需要修的目录
const TARGET_DIRS = [
  "vendors",
  "updates",
  "reports",
  "categories",
  "who-uses"
];

// 简单判断类标签行（head/meta/script/link/style）
function sanitizeHeadSection(html) {
  // 1. <head$1 ...> => <head>
  let out = html.replace(/<head\$1[^>]*>/gi, "<head>");

  // 2. 把 ... 从 <head> 区域里的标记性标签里去掉
  //    我们不想无脑删正文里的 "..."（有时候正文本来就想用省略号）
  //    所以我们只对 <head> 到 </head> 之间做清理
  out = out.replace(/<head>([\s\S]*?)<\/head>/gi, (m, inner) => {
    let fixedInner = inner;

    // 删除 meta/link/script/style 标签里的 "..." 残渣
    // 例如 content="default-sr...tps://forms.gle"
    fixedInner = fixedInner.replace(/(<(?:meta|link|script|style)[^>]*?)\.\.\./gi, "$1");

    // 同时删掉 data-cg-seo="1"> 之前可能被截断残渣里的 ...
    fixedInner = fixedInner.replace(/\.\.\./g, "");

    return "<head>" + fixedInner + "</head>";
  });

  return out;
}

// 如果文件不是 <!doctype html> 开头，就补一行
function ensureDoctype(html) {
  const trimmed = html.trimStart();
  if (/^<!doctype html>/i.test(trimmed)) return html;
  return "<!doctype html>\n" + html;
}

function processFile(fullPath) {
  let raw = fs.readFileSync(fullPath, "utf8");

  const before = raw;
  let fixed = raw;

  fixed = sanitizeHeadSection(fixed);
  fixed = ensureDoctype(fixed);

  if (fixed !== before) {
    fs.writeFileSync(fullPath, fixed, "utf8");
    console.log("[repair_pages] fixed:", fullPath);
    return true;
  }
  return false;
}

function walkDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const changed = [];
  const stack = [dirPath];
  while (stack.length) {
    const cur = stack.pop();
    const st = fs.statSync(cur);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(cur)) {
        stack.push(path.join(cur, f));
      }
    } else if (st.isFile()) {
      if (cur.endsWith(".html")) {
        if (processFile(cur)) changed.push(cur);
      }
    }
  }
  return changed;
}

function main() {
  let totalChanged = 0;
  for (const dir of TARGET_DIRS) {
    const list = walkDir(dir);
    totalChanged += list.length;
  }
  console.log(`[repair_pages] done. changed files: ${totalChanged}`);
}

main();
