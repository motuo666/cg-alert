"use strict";

/**
 * scripts/repair_pages.js
 *
 * 目的（P0 自愈）：
 *   1. 扫描 vendors/, updates/, reports/, categories/, who-uses/ 下所有 .html
 *   2. 把坏掉的 <head$1 ...> 统一修成 <head>
 *   3. 把 <head> 区域里的 '...' 残渣从 <meta>/<link>/<script>/<style> 标签里清理掉
 *   4. 如果文件不是 <!doctype html> 开头，自动补 <!doctype html>
 *
 * 用法（本地 or GitHub Actions 都可以）:
 *   node scripts/repair_pages.js
 *
 * 输出：
 *   - 直接覆盖原文件（就地修复）
 *   - stdout 打印被修改的文件名
 *
 * 为什么必须跑：
 *   站上那些 vendors/* / reports/* / updates/* 页面现在长得像半成品：
 *   <head$1>、meta 里一堆 "..."、CSP 被截断。
 *   这些会劝退买家、让法务觉得不可信。
 *   这个脚本就是自动洗干净，让站至少像个能刷卡的成品。
 */

const fs = require("fs");
const path = require("path");

// 我们会修这些目录下的所有 .html
const TARGET_DIRS = [
  "vendors",
  "updates",
  "reports",
  "categories",
  "who-uses",
];

/**
 * sanitizeHeadSection(html: string) -> string
 *
 * - 把 <head$1 ...> 之类的错误标签改成 <head>
 * - 取出 <head>...</head> 这一段，在里面把 "..." 从 <meta>/<link>/<script>/<style> 标签里干掉
 *   （正文里的 "..." 不碰，只清理 <head> 内部）
 */
function sanitizeHeadSection(html) {
  // 1. <head$1 ...> => <head>
  let out = html.replace(/<head\$1[^>]*>/gi, "<head>");

  // 2. 只处理 <head>...</head> 里的脏东西
  out = out.replace(/<head>([\s\S]*?)<\/head>/gi, (fullMatch, inner) => {
    let fixedInner = inner;

    // 把标签属性里的 "..." 去掉
    // 例： <meta content="default-sr...tps://forms.gle...">
    // 我们清理掉 "..."，保留剩余字符，避免 meta/CSP/OG 头部看起来像残废
    fixedInner = fixedInner.replace(
      /(<(?:meta|link|script|style)[^>]*?)\.\.\./gi,
      "$1"
    );

    // 再兜底一层，把 head 区域里孤立的 "..." 直接删掉
    fixedInner = fixedInner.replace(/\.\.\./g, "");

    return "<head>" + fixedInner + "</head>";
  });

  return out;
}

/**
 * ensureDoctype(html: string) -> string
 *
 * - 如果文件不是以 <!doctype html> 开头，补一行标准 doctype 到最前面
 *   我们不做太强的正则清洗，只要前面没这个声明，就在最顶部插入。
 */
function ensureDoctype(html) {
  const trimmed = html.trimStart();
  if (/^<!doctype html>/i.test(trimmed)) {
    return html;
  }
  return "<!doctype html>\n" + html;
}

/**
 * processFile(fullPath: string)
 *
 * - 读文件
 * - sanitizeHeadSection / ensureDoctype
 * - 如果有变化就写回并打印
 */
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

/**
 * walkDir(dirPath: string)
 *
 * - 深度遍历目录
 * - 对 .html 结尾的文件调用 processFile
 */
function walkDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const changedList = [];
  const stack = [dirPath];

  while (stack.length) {
    const cur = stack.pop();
    const st = fs.statSync(cur);

    if (st.isDirectory()) {
      for (const f of fs.readdirSync(cur)) {
        stack.push(path.join(cur, f));
      }
    } else if (st.isFile() && cur.toLowerCase().endsWith(".html")) {
      if (processFile(cur)) {
        changedList.push(cur);
      }
    }
  }

  return changedList;
}

/**
 * main()
 *
 * - 遍历所有目标目录
 * - 打印总共修了多少文件
 * - 永远退出码 0（不让 GitHub Action 因为“没有修改”就报错）
 */
function main() {
  let totalChanged = 0;
  for (const dir of TARGET_DIRS) {
    const changed = walkDir(dir);
    totalChanged += changed.length;
  }
  console.log(`[repair_pages] done. changed files: ${totalChanged}`);
}

// run
main();
