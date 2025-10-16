#!/usr/bin/env node
/**
 * build_vendor_catalog.js (safe)
 * 作用：从 evidence/<vendor>/*.json 聚合出 vendor 的最新变更摘要（时间/URL/片段）
 * 输出：data/vendor_catalog.csv（可被其他脚本/页面使用）
 * 稳健性：
 *  - 时间戳优先取 it.timestamp/it.ts；否则从文件名提取 YYYY-MM-DD；再否则用 fs.mtime
 *  - 任何无效时间都跳过或降级为 mtime，绝不抛 RangeError
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVID_DIR = path.join(ROOT, 'evidence');
const OUT_CSV = path.join(ROOT, 'data', 'vendor_catalog.csv');

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(f => f.isFile() && f.name.endsWith('.json'))
    .map(f => f.name);
}

function readJSON(fp) {
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [data];
  } catch {
    return [];
  }
}

function extractDateFromFilename(fname) {
  // 只取开头的 YYYY-MM-DD
  const m = fname.match(/^(\d{4}-\d{2}-\d{2})-/);
  return m ? m[1] : null;
}

function toIsoSafe(input, fallbackDate) {
  // input：可能是 ISO 字符串，也可能是 Date，也可能为空
  // fallbackDate：Date 或 null
  let d = null;

  if (input instanceof Date && !isNaN(input)) {
    d = input;
  } else if (typeof input === 'string') {
    // 常见变体：'2025-10-15 12:34:56Z' / '2025-10-15' / '2025/10/15'
    let s = input.trim();
    // 标准化空格为 'T'
    if (/^\d{4}-\d{2}-\d{2} /.test(s)) s = s.replace(' ', 'T');
    // 补全日期无时间的情况
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s = s + 'T00:00:00Z';
    const t = Date.parse(s);
    if (!Number.isNaN(t)) d = new Date(t);
  }

  if (!d && fallbackDate instanceof Date && !isNaN(fallbackDate)) {
    d = fallbackDate;
  }
  if (!d) return null;
  try {
    return d.toISOString();
  } catch {
    return null;
  }
}

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function sanitize(s) {
  return (s || '')
    .toString()
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/"/g, '""'); // 为 CSV 转义双引号
}

function main() {
  const vendors = listDirs(EVID_DIR);
  let rows = [];
  let badTs = 0, total = 0;

  for (const vendor of vendors) {
    const dir = path.join(EVID_DIR, vendor);
    const files = listJsonFiles(dir);

    for (const f of files) {
      const fp = path.join(dir, f);
      const stats = fs.statSync(fp);
      const mtime = stats.mtime; // 作为最后兜底的时间
      const fileDate = extractDateFromFilename(f); // 'YYYY-MM-DD' or null
      const fileDateIso = fileDate ? fileDate + 'T00:00:00Z' : null;

      const items = readJSON(fp);
      for (const it of items) {
        total++;
        // 优先级：it.timestamp / it.ts → 文件名日期 → mtime
        const iso =
          toIsoSafe(it.timestamp || it.ts || '', null) ||
          toIsoSafe(fileDateIso, null) ||
          toIsoSafe(null, mtime);

        if (!iso) { badTs++; continue; }

        const url = it.url || it.URL || it.link || '';
        const snippet = it.snippet || it.fragment || it.text || '';

        rows.push({
          vendor,
          ts: iso,
          url: url,
          snippet: sanitize(snippet),
        });
      }
    }
  }

  // 按时间倒序
  rows.sort((a, b) => (a.ts < b.ts ? 1 : -1));

  // 写 CSV：vendor,ts,url,snippet
  ensureDir(OUT_CSV);
  const header = 'vendor,ts,url,snippet\n';
  const body = rows.map(r =>
    `"${r.vendor}","${r.ts}","${sanitize(r.url)}","${r.snippet}"`
  ).join('\n');
  fs.writeFileSync(OUT_CSV, header + body, 'utf8');

  // 控制台与 Step Summary 友好输出
  const summary = [
    `vendor_catalog: vendors=${vendors.length}, records=${rows.length}, bad_ts_skipped=${badTs}`,
    `output: ${path.relative(ROOT, OUT_CSV)}`
  ].join('\n');

  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Vendor Catalog\n' + summary + '\n', 'utf8');
  }
}

main();
