#!/usr/bin/env node
/**
 * 扫描 evidence/<slug>/<YYYY-MM-DD>-<Type>-<hash>.json（兼容下划线等变体）
 * 生成 data/evidence.ndx（TSV）：date \t slug \t type \t hash \t path
 * - 若文件名的 hash 为 00000000 或 JSON 中缺失 hash，则尝试从 .cache/http/<host>/<encoded-path>.body.txt 计算 SHA256 兜底
 */
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const EVD  = path.join(ROOT, 'evidence');
const OUT  = path.join(ROOT, 'data', 'evidence.ndx');

// 更宽松的文件名匹配：- 或 _ 作为分隔；type 放宽为非斜杠的最短匹配；hash 六位以上十六进制或 0 串
const RE = /^evidence\/([^/]+)\/(\d{4}-\d{2}-\d{2})[-_]([^\/]+?)[-_]([a-f0-9]{6,})\.json$/i;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function safeReadJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return {}; }
}

function encodePath(pth) {
  // 与 poll_public_endpoints.js 基本一致：对整条 path+search 做 encodeURIComponent，再把 %2F 复原成 /
  return encodeURIComponent(pth).replace(/%2F/g, '/');
}

function readCachedBody(u) {
  try {
    const { host, pathname, search } = new URL(u);
    const raw = pathname + (search || '');
    const guess1 = path.join(ROOT, '.cache', 'http', host, encodePath(raw) + '.body.txt');
    if (fs.existsSync(guess1)) return fs.readFileSync(guess1);
    // 兼容早期“弱编码”路径
    const weak = raw.replace(/[^\w\-./]/g, '_');
    const guess2 = path.join(ROOT, '.cache', 'http', host, weak + '.body.txt');
    if (fs.existsSync(guess2)) return fs.readFileSync(guess2);
  } catch {}
  return null;
}

function sha256Hex(buf) {
  try { return crypto.createHash('sha256').update(buf).digest('hex'); }
  catch { return ''; }
}

(function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const lines = [];

  for (const f of walk(EVD)) {
    if (!/\.json$/i.test(f)) continue;
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    let slug, date, type, hash = '';

    const m = rel.match(RE);
    if (m) {
      [, slug, date, type, hash] = m;
      if (/^0+$/i.test(hash)) hash = ''; // 文件名的 00000000 视为无 hash
    }

    const j = safeReadJSON(path.join(ROOT, rel));
    if (!slug) slug = rel.split('/')[1] || '';
    if (!date) date = String(j.date || j.detected_at || '').slice(0, 10);
    if (!type) type = j.type || 'Change';
    if (!hash) hash = j.hash || '';

    // 仍无 hash，尝试从缓存页面内容计算
    if (!hash && j.url) {
      const body = readCachedBody(j.url);
      if (body && body.length) {
        hash = sha256Hex(body); // 全 64 位，渲染时会截到 8 位
      }
    }

    if (!date) continue; // 没日期不入索引
    lines.push([date, slug, type, hash, rel].join('\t'));
  }

  lines.sort(); // 按日期排序
  fs.writeFileSync(OUT, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  console.log(`indexed: ${lines.length} records -> ${path.relative(ROOT, OUT)}`);
})();
