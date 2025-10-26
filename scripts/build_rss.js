#!/usr/bin/env node

// CommonJS 版本，兼容 GitHub Actions 现在的运行环境
const fs = require('fs');
const path = require('path');

// 以仓库根目录为基准
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'evidence');
const OUT_FILE = path.join(ROOT, 'public', 'rss.xml');

// 安全转义成 XML
function escapeXml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
}

// 我们不会发布这些垃圾 / 内部占位商户
function shouldPublishVendor(v = '') {
  if (!v) return false;
  if (v.startsWith('_')) return false;
  if (v === 'acme') return false;
  if (v.startsWith('status.')) return false;
  if (v === 'status.domain') return false;
  return true;
}

// 递归收集 evidence/ 下面所有 *.json
function collectEvidenceJsonFiles(rootDir) {
  const out = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir);
    for (const name of entries) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (
        st.isFile() &&
        name.toLowerCase().endsWith('.json')
      ) {
        out.push(full);
      }
    }
  }

  walk(rootDir);
  return out;
}

// 把所有 evidence/*.json 读进来，按 detected_at 倒序
function loadAll() {
  const files = collectEvidenceJsonFiles(SRC_DIR);
  const list = [];

  for (const fp of files) {
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      const d = JSON.parse(raw);

      // 后面生成 <item> 用到的辅助字段
      d.__slug = path.basename(fp).replace(/\.json$/i, '.html');
      d.__vendor = d.vendor;

      list.push(d);
    } catch (err) {
      // 坏/半写文件直接跳过，不让整条 job 挂
    }
  }

  // 新的在前
  list.sort((a, b) => {
    const ta = new Date(b.detected_at || 0).getTime();
    const tb = new Date(a.detected_at || 0).getTime();
    return ta - tb;
  });

  return list;
}

// 组装 RSS 文本（带去重 + 描述）
function buildRss(items) {
  const now = new Date().toUTCString();

  const seen = new Set(); // 去重 (vendor + type + dateStr)
  const rssItemsArr = [];

  for (const it of items) {
    const vendor = it.__vendor || '';
    if (!vendor) continue;

    const slug = it.__slug || 'unknown.html';
    const permalink = `https://www.cg-alert.com/evidence/${vendor}/${slug}`;

    const dateStr = (it.detected_at || '').split('T')[0] || '';
    const pub = new Date(it.detected_at || Date.now()).toUTCString();

    const typ = it.type || 'Change';
    const impact = it.impact || it.severity || 'n/a';

    // 同一个 vendor / type / day 只保留一条，避免 spam
    const dedupeKey = `${vendor}::${typ}::${dateStr}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const title = `${vendor} ${typ} (${dateStr})`;

    // 给读RSS的人看的简短说明：发生了什么+为什么重要
    const humanDesc = `${vendor} ${typ} change observed ${dateStr}. Impact: ${impact}. Evidence captured (timestamp, source URL, cryptographic hash) for Procurement / Legal / Finance leverage.`;

    const oneItemXml = [
      '<item>',
      `<title>${escapeXml(title)}</title>`,
      `<link>${escapeXml(permalink)}</link>`,
      `<guid isPermaLink="false">${escapeXml(vendor + '/' + slug)}</guid>`,
      `<pubDate>${escapeXml(pub)}</pubDate>`,
      `<description>${escapeXml(humanDesc)}</description>`,
      '</item>'
    ].join('\n');

    rssItemsArr.push(oneItemXml);

    // 限制长度，避免RSS太胖
    if (rssItemsArr.length >= 60) break;
  }

  const channelDesc =
    'High-signal vendor change evidence with timestamp, source URL, and cryptographic hash for Procurement / Legal Ops / Finance audit. Not legal advice.';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    '<title>CG Alert — Evidence Feed</title>',
    '<link>https://www.cg-alert.com/</link>',
    '<atom:link href="https://www.cg-alert.com/rss.xml" rel="self" type="application/rss+xml"/>',
    '<description>',
    escapeXml(channelDesc),
    '</description>',
    '<language>en-us</language>',
    `<lastBuildDate>${escapeXml(now)}</lastBuildDate>`,
    rssItemsArr.join('\n'),
    '</channel>',
    '</rss>',
    ''
  ].join('\n');
}

// 主流程
(function main() {
  // 1. 读全部证据
  const all = loadAll();

  // 2. 去掉我们不想暴露的 vendor
  const filtered = all.filter(it => shouldPublishVendor(it.vendor));

  // 3. 构建 RSS
  const xml = buildRss(filtered);

  // 4. 写到 public/rss.xml
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, xml, 'utf8');

  console.log(
    '✅ rss.xml generated with',
    filtered.length,
    'raw items before dedupe;',
    'final unique items =',
    (xml.match(/<item>/g) || []).length
  );
})();
