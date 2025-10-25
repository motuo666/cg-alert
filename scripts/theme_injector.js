#!/usr/bin/env node
"use strict";

/**
 * theme_injector.js 终态版
 *
 * 目标：
 * 1. 页面里只能有一个全站头部导航（横向的 CG Alert），不允许再出现竖排/第二个 header。
 * 2. 每个页面 <head> 里必须带站点样式，否则 /reports/ 会把 "CG Alert" 挤成两行。
 * 3. color-scheme 统一浅色，避免厂商页右侧整块黑背景。
 *
 * 做法：
 * - 先删掉页面里所有 <header>...</header>
 * - 确保 <head> 里有:
 *      <link rel="stylesheet" href="/styles.css">
 *      <link rel="stylesheet" href="/assets/cg-theme.css">
 *      <meta name="color-scheme" content="light">
 * - 在 <body> 打开标签后面插入唯一标记过的 HEADER_BLOCK（带 <!--APP_HEADER-->）
 * - 如果页面已经包含 <!--APP_HEADER-->，不再重复插入，只做 head 修正 & 再次清理其他 header
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

// 哪些目录的 HTML 需要被规范化
const TARGET_DIRS = [
  ".",            // 根目录里的页面 (index.html, who-uses.html 等)
  "public",       // 兼容历史遗留
  "reports",      // /reports/ 以及 /reports/YYYY-MM/vendor/
  "who-uses",
  "seo",
  "evidence"
];

// 明确不去遍历的目录
const EXCLUDE = new Set([
  "node_modules",
  ".git",
  ".github",
  ".next",
  ".vercel",
  ".vscode"
]);

const EXT_HTML = /\.html?$/i;

// 唯一标记，防止重复注入
const HEADER_MARK = "<!--APP_HEADER-->";

const HEADER_BLOCK = `
${HEADER_MARK}
<header class="app-header">
  <div class="nav container">
    <a class="logo" href="/"><img src="/icon.svg" alt="CG Alert">CG Alert</a>
    <a href="/reports/">Reports</a>
    <a href="/who-uses/">Who Uses</a>
    <a href="/rss.xml" rel="nofollow">RSS</a>
  </div>
</header>`.trim();

/**
 * 深度遍历一个目录，yield 出所有 .html / .htm 文件路径
 */
function* walk(dir) {
  let st;
  try {
    st = fs.statSync(dir);
  } catch {
    return;
  }
  if (!st.isDirectory()) return;

  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of ents) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (EXCLUDE.has(ent.name)) continue;
      yield* walk(full);
    } else if (ent.isFile() && EXT_HTML.test(ent.name)) {
      yield full;
    }
  }
}

/**
 * 移除页面里所有 header（不管它是不是旧的竖排版本）
 */
function stripAllHeaders(html) {
  return html.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, "");
}

/**
 * 确保 <head> 里有 styles.css / cg-theme.css / color-scheme=light
 * 如果缺，就在 </head> 前面强塞
 */
function ensureHeadBits(html) {
  let out = html;

  // 如果页面甚至没有 </head>，我们也没法注入，这种页面直接跳过
  if (!/<\/head>/i.test(out)) {
    return out;
  }

  // /styles.css
  if (!/href=["']\/styles\.css["']/i.test(out)) {
    out = out.replace(
      /<\/head>/i,
      `  <link rel="stylesheet" href="/styles.css">\n</head>`
    );
  }

  // /assets/cg-theme.css
  if (!/href=["']\/assets\/cg-theme\.css["']/i.test(out)) {
    out = out.replace(
      /<\/head>/i,
      `  <link rel="stylesheet" href="/assets/cg-theme.css">\n</head>`
    );
  }

  // 强制浅色，避免右侧整块黑背景
  if (!/<meta[^>]+name=["']color-scheme["']/i.test(out)) {
    out = out.replace(
      /<\/head>/i,
      `  <meta name="color-scheme" content="light">\n</head>`
    );
  }

  return out;
}

/**
 * 把我们标准的 HEADER_BLOCK 注入到 <body> 后面
 * - 如果已经有 <!--APP_HEADER-->，不再重复注入
 */
function injectHeaderOnce(html) {
  // 如果已经注入过（我们自己放的标记），就直接返回
  if (html.includes(HEADER_MARK)) {
    return html;
  }

  // 如果没有 <body>，那我们也没法注入
  if (!/<body[^>]*>/i.test(html)) {
    return html;
  }

  return html.replace(/<body[^>]*>/i, (m) => m + "\n" + HEADER_BLOCK);
}

/**
 * 最终处理单个文件：
 * 1. stripAllHeaders → 不管页面之前有什么 header 全部砍掉
 * 2. ensureHeadBits  → 注入主题样式 + 浅色模式
 * 3. injectHeaderOnce→ 保证只有我们自己的横向导航出现一次
 * 4. 再次 stripAllHeaders 但保留我们标记的块
 *    （防止极端情况下页面里还有别的 header 片段被拼回来）
 */
function processHtml(source) {
  let s = source;

  // 先把所有 header 清空
  s = stripAllHeaders(s);

  // 注入 head 必需资源
  s = ensureHeadBits(s);

  // 主站导航（横向 CG Alert）
  s = injectHeaderOnce(s);

  // 万一页面本身在 <main> 之后还偷偷塞了 header（极端情况）
  // 我们需要确保别把我们刚注入的 HEADER_BLOCK 干掉
  // 做法：先把它临时拿出来，再 strip，再塞回去
  if (s.includes(HEADER_MARK)) {
    const SAFE_TOKEN = "___APP_HEADER_BLOCK___UNIQUE_TOKEN___";
    // 把我们的 header block摘出来
    const headerRegex = new RegExp(
      `${HEADER_MARK}[\\s\\S]*?</header>`,
      "i"
    );
    const extracted = s.match(headerRegex);
    let headerSaved = "";
    if (extracted) {
      headerSaved = extracted[0];
      s = s.replace(headerRegex, SAFE_TOKEN);
    }

    // 再进行一次全局 header 清除（把残留的旧垃圾再扒一遍）
    s = stripAllHeaders(s);

    // 把我们那块 header 再放回 SAFE_TOKEN 的位置
    if (headerSaved) {
      s = s.replace(SAFE_TOKEN, headerSaved);
    }
  }

  return s;
}

/**
 * 对单个文件路径进行处理
 */
function processFile(fp) {
  const raw = fs.readFileSync(fp, "utf8");
  const updated = processHtml(raw);

  if (updated !== raw) {
    fs.writeFileSync(fp, updated, "utf8");
    return true;
  }
  return false;
}

// 主执行入口
let scanned = 0;
let changed = 0;

for (const base of TARGET_DIRS) {
  const abs = path.join(ROOT, base);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    scanned++;
    if (processFile(file)) changed++;
  }
}

console.log(
  `theme_injector (final): scanned=${scanned} changed=${changed}`
);
